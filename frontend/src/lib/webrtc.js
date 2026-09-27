// Shared by useCall.js (1:1) and useGroupCall.js (mesh) - extracted so the
// camera-selection and ICE-gathering fixes only ever need to be right once.

// No STUN/TURN servers - by design (see backend/app/calling.py). Both peers
// are always on the same subnet, so only local host ICE candidates are ever
// needed, and there's never a NAT to traverse.
export const RTC_CONFIG = { iceServers: [] };

// Non-trickle ICE for this first pass: wait for gathering to finish before
// sending the offer/answer, so the SDP already contains every candidate and
// the existing call_ice relay isn't required for basic connectivity to work.
export function waitForIceGatheringComplete(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    function check() {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    }
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(resolve, 3000); // safety net if gathering ever stalls
  });
}

// Some Windows laptops expose a second "camera" purely for Windows Hello
// face login (infrared) alongside the real one - prefer whichever enumerated
// camera doesn't look IR-labeled.
async function pickCameraDeviceId() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((d) => d.kind === "videoinput");
    if (cameras.length <= 1) return undefined;
    const nonIr = cameras.filter((d) => !/infrared|\bir\b|hello/i.test(d.label));
    return (nonIr[0] || cameras[0]).deviceId || undefined;
  } catch {
    return undefined;
  }
}

export async function getLocalStream(media) {
  const videoDeviceId = media === "video" ? await pickCameraDeviceId() : undefined;
  return navigator.mediaDevices.getUserMedia({
    audio: true,
    video: media !== "video" ? false : videoDeviceId ? { deviceId: { exact: videoDeviceId } } : true,
  });
}
