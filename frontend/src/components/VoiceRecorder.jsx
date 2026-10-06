import { useEffect, useRef, useState } from "react";
import WaveformBars from "./WaveformBars";
import { decodeAudioPeaks, createLiveAmplitudeSampler, BUCKET_COUNT } from "../lib/waveform";

// Matches the design reference's 9.1 (hold to record, slide to cancel,
// lock to go hands-free) and 9.2 (review before sending) screens, adapted
// from touch gestures to mouse ones - hold becomes mousedown/mouseup,
// slide-to-cancel becomes dragging the mouse left past a threshold while
// held. Lock is drag-up past a threshold, the same family of gesture as
// slide-to-cancel, rather than a separate clickable target: a real mouse
// can only hold one button down at a time, so "keep holding the mic AND
// click a different button" (what a first pass at this actually tried)
// is a real user physically cannot do with a mouse - caught live, not on
// paper, when a Playwright-driven click on a separate Lock button worked
// in the test but could never correspond to anything a real mouse could
// do. Desktop has no accelerometer, so the reference's "raise to listen"
// setting has no equivalent here - left out rather than faked.
//
// Owns the entire record -> (cancel | lock -> stop) -> review -> send/
// discard state machine itself so both composers (1:1 and group) stay
// simple: they just render this and get called back with a finished
// blob once the user actually presses Send.
const SLIDE_CANCEL_PX = 80;
const DRAG_LOCK_PX = 70;

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function VoiceRecorder({ disabled, onSend, onActiveChange }) {
  const [stage, setStage] = useState("idle"); // idle | recording | locked | review
  const [seconds, setSeconds] = useState(0);
  const [livePeaks, setLivePeaks] = useState([]);
  const [slidPastCancel, setSlidPastCancel] = useState(false);
  const [armedToLock, setArmedToLock] = useState(false);
  const [reviewBlob, setReviewBlob] = useState(null);
  const [reviewPeaks, setReviewPeaks] = useState([]);
  const [note, setNote] = useState("");
  const [playing, setPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const stopSamplerRef = useRef(null);
  const timerRef = useRef(null);
  const lockedRef = useRef(false);
  const cancelledRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartYRef = useRef(0);
  const reviewAudioRef = useRef(null);
  const reviewUrlRef = useRef(null);

  async function startRecording(e) {
    if (disabled || stage !== "idle") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      chunksRef.current = [];
      lockedRef.current = false;
      cancelledRef.current = false;
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        stopSamplerRef.current?.();
        clearInterval(timerRef.current);
        if (cancelledRef.current || chunksRef.current.length === 0) {
          setStage("idle");
          return;
        }
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setReviewBlob(blob);
        enterReview(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      dragStartXRef.current = e.clientX;
      dragStartYRef.current = e.clientY;
      setSlidPastCancel(false);
      setArmedToLock(false);
      lockedRef.current = false;
      setSeconds(0);
      setStage("recording");
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      stopSamplerRef.current = createLiveAmplitudeSampler(stream, BUCKET_COUNT, setLivePeaks);
    } catch {
      // mic permission denied, or no input device - nothing to record
    }
  }

  function finishHold() {
    if (stage !== "recording") return;
    if (slidPastCancel) {
      cancelledRef.current = true;
      mediaRecorderRef.current?.stop();
      return;
    }
    if (lockedRef.current) {
      setStage("locked");
      return;
    }
    mediaRecorderRef.current?.stop();
  }

  function stopLocked() {
    mediaRecorderRef.current?.stop();
  }

  useEffect(() => {
    if (stage !== "recording") return;
    function onMouseMove(e) {
      const dx = e.clientX - dragStartXRef.current;
      const dy = e.clientY - dragStartYRef.current;
      setSlidPastCancel(dx < -SLIDE_CANCEL_PX);
      // Drag up past the threshold arms the lock - same single-continuous-
      // hold gesture family as slide-to-cancel, checked at release time via
      // the ref (lockedRef), not the dx/dy themselves, since by then the
      // mouse may have moved back toward center.
      if (dy < -DRAG_LOCK_PX) {
        lockedRef.current = true;
        setArmedToLock(true);
      }
    }
    function onMouseUp() {
      finishHold();
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, slidPastCancel]);

  useEffect(() => {
    if (stage !== "idle") return;
    function onKeyDown(e) {
      if (e.key === "Escape") discardReview();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enterReview(blob) {
    setStage("review");
    setPlaying(false);
    setPlayProgress(0);
    setNote("");
    const buf = await blob.arrayBuffer();
    try {
      const { peaks } = await decodeAudioPeaks(buf);
      setReviewPeaks(peaks);
    } catch {
      setReviewPeaks(new Array(BUCKET_COUNT).fill(0.3));
    }
    reviewUrlRef.current = URL.createObjectURL(blob);
  }

  function discardReview() {
    if (stage !== "review") return;
    reviewAudioRef.current?.pause();
    if (reviewUrlRef.current) URL.revokeObjectURL(reviewUrlRef.current);
    reviewUrlRef.current = null;
    setReviewBlob(null);
    setStage("idle");
  }

  function togglePlay() {
    const el = reviewAudioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
    } else {
      if (!el.src) el.src = reviewUrlRef.current;
      el.play().catch(() => {});
    }
  }

  function handleSend() {
    if (!reviewBlob) return;
    onSend(reviewBlob, note.trim());
    reviewAudioRef.current?.pause();
    if (reviewUrlRef.current) URL.revokeObjectURL(reviewUrlRef.current);
    reviewUrlRef.current = null;
    setReviewBlob(null);
    setStage("idle");
  }

  useEffect(() => {
    return () => {
      stopSamplerRef.current?.();
      clearInterval(timerRef.current);
      if (reviewUrlRef.current) URL.revokeObjectURL(reviewUrlRef.current);
    };
  }, []);

  // Lets the composer hide its normal attach/input/send row while this is
  // anything but idle, so the recording/review bar can take over the full
  // width the same way the design reference's bottom bar actually
  // transforms, rather than being squeezed in alongside controls that no
  // longer make sense mid-recording.
  const onActiveChangeRef = useRef(onActiveChange);
  onActiveChangeRef.current = onActiveChange;
  useEffect(() => {
    onActiveChangeRef.current?.(stage !== "idle");
  }, [stage]);

  if (stage === "review") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
        <audio
          ref={reviewAudioRef}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPlayProgress(0);
          }}
          onTimeUpdate={(e) => setPlayProgress(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)}
          hidden
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)" }}>
          <button onClick={togglePlay} style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 99, background: "var(--accent-soft, #f3e8dd)", border: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {playing ? <PauseGlyph /> : <PlayGlyph />}
          </button>
          <WaveformBars peaks={reviewPeaks} progress={playProgress} barColor="var(--border)" playedColor="var(--accent)" />
          <span className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)", flexShrink: 0 }}>
            {fmtTime(seconds)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={discardReview} title="Discard this recording" style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 12, background: "var(--danger-soft)", border: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <TrashGlyph />
          </button>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" style={{ flex: 1, height: 38, borderRadius: 12, border: "1px solid var(--border)", padding: "0 13px", fontSize: 13.5 }} />
          <button onClick={handleSend} style={{ padding: "0 16px", height: 38, borderRadius: 12, border: "none", background: "var(--accent)", color: "#fff8f2", fontWeight: 600, fontSize: 13.5, flexShrink: 0 }}>
            Send
          </button>
        </div>
      </div>
    );
  }

  if (stage === "recording" || stage === "locked") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 14px", borderRadius: 16, background: "var(--surface)", border: "1.5px solid var(--accent)", opacity: slidPastCancel ? 0.45 : 1 }}>
        <span style={{ width: 9, height: 9, borderRadius: 99, background: "var(--danger)", flexShrink: 0, animation: "agBlink 1.2s ease-in-out infinite" }} />
        <WaveformBars peaks={livePeaks.length ? livePeaks : [0.1]} barColor="var(--accent)" />
        <span className="mono" style={{ fontSize: 11.5, color: "var(--accent-strong)", flexShrink: 0 }}>
          {fmtTime(seconds)}
        </span>
        {stage === "recording" ? (
          <>
            <span style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0, display: "flex", alignItems: "center", gap: 3 }}>{slidPastCancel ? "Release to cancel" : "‹ Slide to cancel"}</span>
            {/* A target, not a button a mouse could click while still
                held - a real mouse only has one button, so "keep holding
                the mic AND click something else" isn't something a real
                user can do. Dragging up past the threshold (tracked in
                the mousemove handler above) arms it instead, same gesture
                family as slide-to-cancel; this just reflects that state. */}
            <span title="Drag up to lock - keep recording hands-free" style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 10, background: armedToLock ? "var(--accent)" : "var(--panel)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <LockGlyph color={armedToLock ? "#fff8f2" : "var(--text-strong)"} />
            </span>
          </>
        ) : (
          <button onClick={stopLocked} style={{ padding: "0 14px", height: 32, flexShrink: 0, borderRadius: 10, background: "#2a2320", color: "#fff8f2", border: "none", fontSize: 12, fontWeight: 600 }}>
            Stop
          </button>
        )}
      </div>
    );
  }

  return (
    <button
      onMouseDown={startRecording}
      disabled={disabled}
      title="Hold to record a voice message"
      style={{ width: 38, height: 38, minWidth: 38, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", opacity: disabled ? 0.5 : 1, flexShrink: 0 }}
    >
      <MicGlyph color="var(--icon-muted)" />
    </button>
  );
}

function MicGlyph({ color = "currentColor" }) {
  return (
    <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
      <rect x="6.5" y="2" width="5" height="9" rx="2.5" stroke={color} strokeWidth="1.4" />
      <path d="M4 9.5a5 5 0 0 0 10 0" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M9 14.5v2" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function LockGlyph({ color = "var(--text-strong)" }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" stroke={color} strokeWidth="1.3" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke={color} strokeWidth="1.3" />
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4.5 4.5l.6 8.5a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.5" stroke="var(--danger)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlayGlyph() {
  return <div style={{ width: 0, height: 0, borderLeft: "11px solid var(--accent-strong)", borderTop: "7px solid transparent", borderBottom: "7px solid transparent", marginLeft: 3 }} />;
}

function PauseGlyph() {
  return (
    <div style={{ display: "flex", gap: 3 }}>
      <div style={{ width: 4, height: 13, background: "var(--accent-strong)", borderRadius: 1 }} />
      <div style={{ width: 4, height: 13, background: "var(--accent-strong)", borderRadius: 1 }} />
    </div>
  );
}
