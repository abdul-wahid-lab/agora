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

// Shared by both useCall.js (1:1) and useGroupCall.js's incoming-call
// prompt - a plain two-tone ring, synthesized rather than shipped as an
// audio file, no asset to load, and it plays regardless of window focus
// (unlike a full-screen overlay, which only helps if the window is
// actually visible).
export function startRingtone() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  // Starts "suspended" if the page hasn't registered a user gesture recently
  // enough for Chrome's autoplay policy - resume() is a no-op if it's
  // already running, and harmless (silently stays suspended) if the
  // browser refuses; real usage almost always has plenty of prior clicks
  // (onboarding, nav) before a call could arrive, so this is a safety net
  // more than the primary mechanism.
  ctx.resume().catch(() => {});
  let stopped = false;

  function ring() {
    if (stopped) return;
    for (const delay of [0, 0.3]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + delay + 0.02);
      gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.25);
    }
  }

  ring();
  const interval = setInterval(ring, 1800);
  return () => {
    stopped = true;
    clearInterval(interval);
    ctx.close().catch(() => {});
  };
}

export async function getLocalStream(media) {
  const videoDeviceId = media === "video" ? await pickCameraDeviceId() : undefined;
  return navigator.mediaDevices.getUserMedia({
    audio: true,
    video: media !== "video" ? false : videoDeviceId ? { deviceId: { exact: videoDeviceId } } : true,
  });
}
