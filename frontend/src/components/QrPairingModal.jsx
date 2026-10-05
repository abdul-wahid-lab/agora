import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { api } from "../api";

// Two tabs in one modal: "Your code" renders this device's own signed
// discovery announcement (see api.py's GET /me/qr and discovery.py's
// self_announcement) as a scannable QR code; "Scan a code" reads the
// camera and decodes the other device's announcement from it. Both sides
// of this go through the exact same crypto_identity.verify_announcement +
// check_and_pin_signing_key trust check that live mDNS/UDP discovery
// uses - see POST /peers/add-scanned. A QR code is just a faster way to
// hand that same payload to a peer who hasn't been found on the network
// (or happens to be in another room), not a weaker way in.
export default function QrPairingModal({ onClose, onAdded }) {
  const [tab, setTab] = useState("show");

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 360, maxWidth: "90vw", borderRadius: 18, background: "var(--panel)", border: "1px solid var(--border)", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="serif" style={{ fontSize: 20 }}>
            Add by QR code
          </div>
          <button onClick={onClose} style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Close
          </button>
        </div>

        <div style={{ display: "flex", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", padding: 3, gap: 3 }}>
          {[
            { id: "show", label: "Your code" },
            { id: "scan", label: "Scan a code" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1,
                padding: "7px 0",
                borderRadius: 9,
                fontSize: 12.5,
                fontWeight: 600,
                background: tab === t.id ? "var(--panel)" : "transparent",
                color: tab === t.id ? "var(--text-strong)" : "var(--text-muted)",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "show" ? <ShowCode /> : <ScanCode onClose={onClose} onAdded={onAdded} />}
      </div>
    </div>
  );
}

function drawCenterLogo(canvas) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      const size = canvas.width * 0.22;
      const pad = 6;
      const cx = (canvas.width - size) / 2;
      const cy = (canvas.height - size) / 2;
      // White rounded backing isolates the logo from the surrounding
      // modules so scanners read it as one clean "eye", not noise.
      ctx.fillStyle = "#fff";
      roundRect(ctx, cx - pad, cy - pad, size + pad * 2, size + pad * 2, 10);
      ctx.fill();
      ctx.drawImage(img, cx, cy, size, size);
      resolve();
    };
    img.onerror = () => resolve();
    // Relative path, not "/logo.png" - see TitleBar.jsx's own logo <img> for
    // the full explanation: the packaged app loads index.html via file://,
    // where an absolute path resolves to the filesystem root instead of the
    // app's own folder, so the image silently fails to load and this
    // resolves having drawn nothing - exactly how the QR code ended up with
    // no logo in the middle in a packaged build despite working in dev.
    img.src = "./logo.png";
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function ShowCode() {
  const canvasRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payload = await api.myQr();
        if (cancelled) return;
        if (!payload.signature) {
          setError("This device hasn't finished generating its identity yet. Try again in a moment.");
          return;
        }
        const canvas = canvasRef.current;
        // "H" error correction tolerates up to ~30% of the code being
        // obscured - the logo below covers roughly half that, leaving
        // real margin rather than relying on the whole budget.
        await QRCode.toCanvas(canvas, JSON.stringify(payload), { width: 300, margin: 1, errorCorrectionLevel: "H" });
        await drawCenterLogo(canvas);
      } catch {
        if (!cancelled) setError("Couldn't generate a code.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      {error ? (
        <div style={{ padding: "24px 12px", fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>{error}</div>
      ) : (
        <canvas ref={canvasRef} style={{ borderRadius: 12, background: "#fff", padding: 10 }} />
      )}
      <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.5 }}>
        Have someone scan this with their own "Scan a code" tab to add you directly, without waiting for radar.
      </div>
    </div>
  );
}

function ScanCode({ onClose, onAdded }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const doneRef = useRef(false);
  const [status, setStatus] = useState("starting");
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (doneRef.current || cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.videoWidth > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(frame.data, frame.width, frame.height);
        if (code?.data) {
          doneRef.current = true;
          await handleDecoded(code.data);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    async function handleDecoded(text) {
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        setError("That code isn't a valid Agora pairing code.");
        doneRef.current = false;
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      try {
        await api.addScannedPeer(payload);
        setStatus("added");
        onAdded?.(payload.peer_id);
        setTimeout(onClose, 900);
      } catch (e) {
        setError(e.message.includes("400") || e.message.includes("409") ? "That code was rejected." : "Couldn't add that peer.");
        doneRef.current = false;
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStatus("scanning");
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        if (!cancelled) {
          setStatus("error");
          setError("Couldn't access the camera.");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <div style={{ position: "relative", width: 260, height: 260, borderRadius: 12, overflow: "hidden", background: "#000" }}>
        <video ref={videoRef} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        {status === "added" && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14, fontWeight: 600 }}>
            Added
          </div>
        )}
      </div>
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <div style={{ fontSize: 12, color: error ? "var(--danger, #c0392b)" : "var(--text-muted)", textAlign: "center", minHeight: 16 }}>
        {error || (status === "scanning" ? "Point the camera at the other device's code." : status === "starting" ? "Starting camera…" : null)}
      </div>
    </div>
  );
}
