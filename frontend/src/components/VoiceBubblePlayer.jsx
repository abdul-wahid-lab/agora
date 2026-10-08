import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { decodeAudioPeaks, BUCKET_COUNT } from "../lib/waveform";
import { getTranscribeEnabled, getDefaultSpeed } from "../lib/voiceSettings";
import WaveformBars from "./WaveformBars";

function fmtTime(s) {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// The design reference's 9.3 chat-bubble player: a round play/pause button,
// a real waveform (not native <audio controls>, which this project shipped
// first and the user then pointed at this design to replace), and a
// duration label, in a sent (orange) or received (white) palette. Same
// GET /files/{id}/raw this app already streams video through - fetched
// once here as full bytes too, only to decode real peak data for the
// waveform (an <audio> element can't expose that itself); actual playback
// still goes through the <audio> element's own native streaming/seeking.
export default function VoiceBubblePlayer({ transferId, filename, variant = "received", onFail }) {
  const [peaks, setPeaks] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(getDefaultSpeed);
  const [transcript, setTranscript] = useState(null); // null = not fetched, "" = fetched but empty, string = text
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeFailed, setTranscribeFailed] = useState(false);
  const audioRef = useRef(null);
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;
  const notifiedPlayedRef = useRef(false);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed, peaks]);

  function cycleSpeed() {
    setSpeed((s) => (s === 1 ? 1.5 : s === 1.5 ? 2 : 1));
  }

  function toggleTranscript() {
    if (transcript !== null || transcribeFailed) {
      setTranscript(null);
      setTranscribeFailed(false);
      return;
    }
    setTranscribing(true);
    api
      .transcribeFile(transferId)
      .then((r) => setTranscript(r.text || ""))
      .catch(() => setTranscribeFailed(true))
      .finally(() => setTranscribing(false));
  }

  useEffect(() => {
    let cancelled = false;
    fetch(api.fileRawUrl(transferId))
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => decodeAudioPeaks(buf))
      .then(({ peaks: p, duration: d }) => {
        if (cancelled) return;
        setPeaks(p);
        setDuration(d);
      })
      .catch(() => {
        if (!cancelled) onFailRef.current?.();
      });
    return () => {
      cancelled = true;
    };
  }, [transferId]);

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) el.pause();
    else el.play().catch(() => {});
  }

  const sent = variant === "sent";
  const trackColor = sent ? "rgba(255,248,242,0.4)" : "var(--border)";
  const playedColor = sent ? "#fff8f2" : "var(--accent)";
  const iconCircleBg = sent ? "rgba(255,248,242,0.22)" : "var(--accent-soft)";

  if (!peaks) {
    return <div style={{ height: 40, display: "flex", alignItems: "center", fontSize: 12.5, color: sent ? "#fbdcc8" : "var(--text-muted)" }}>Loading voice message…</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <audio
          ref={audioRef}
          src={api.fileRawUrl(transferId)}
          aria-label={filename}
          onPlay={() => {
            setPlaying(true);
            // Read receipt: only the receiving side's own playback counts,
            // and only once - a replay shouldn't re-notify. The backend's
            // mark_played also no-ops for a sent bubble, but skipping the
            // request entirely here avoids a pointless round trip.
            if (!sent && !notifiedPlayedRef.current) {
              notifiedPlayedRef.current = true;
              api.markFilePlayed(transferId).catch(() => {});
            }
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
          }}
          onTimeUpdate={(e) => setProgress(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          hidden
        />
        <button onClick={togglePlay} style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 99, background: iconCircleBg, border: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {playing ? <PauseGlyph color={sent ? "#fff8f2" : "var(--accent-strong)"} /> : <PlayGlyph color={sent ? "#fff8f2" : "var(--accent-strong)"} />}
        </button>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <WaveformBars peaks={peaks} progress={progress} barColor={trackColor} playedColor={playedColor} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span className="mono" style={{ fontSize: 11, color: sent ? "#fbdcc8" : "var(--text-muted)" }}>
              {playing || progress > 0 ? `${fmtTime(progress * duration)} / ${fmtTime(duration)}` : fmtTime(duration)}
            </span>
            <button
              onClick={cycleSpeed}
              title="Playback speed"
              className="mono"
              style={{
                flexShrink: 0,
                padding: "2px 7px",
                borderRadius: 99,
                border: `1px solid ${sent ? "rgba(255,248,242,0.4)" : "var(--border)"}`,
                background: "transparent",
                fontSize: 10.5,
                fontWeight: 600,
                color: sent ? "#fff8f2" : "var(--text-muted)",
              }}
            >
              {speed}×
            </button>
            {getTranscribeEnabled() && (
            <button
              onClick={toggleTranscript}
              title="Transcribed on this device, never uploaded"
              className="mono"
              style={{
                flexShrink: 0,
                padding: "2px 7px",
                borderRadius: 99,
                border: `1px solid ${sent ? "rgba(255,248,242,0.4)" : "var(--border)"}`,
                background: "transparent",
                fontSize: 10.5,
                fontWeight: 600,
                color: sent ? "#fff8f2" : "var(--text-muted)",
              }}
            >
              {transcribing ? "…" : transcript !== null || transcribeFailed ? "Hide text" : "Transcribe"}
            </button>
            )}
          </div>
        </div>
      </div>
      {getTranscribeEnabled() && (transcript !== null || transcribeFailed) && (
        <div
          className="mono"
          style={{
            fontSize: 12,
            lineHeight: 1.5,
            padding: "8px 10px",
            borderRadius: 10,
            background: sent ? "rgba(255,248,242,0.16)" : "var(--panel)",
            color: sent ? "#fff8f2" : "var(--text)",
          }}
        >
          {transcribeFailed ? "Transcription failed." : transcript || "(no speech detected)"}
        </div>
      )}
    </div>
  );
}

function PlayGlyph({ color }) {
  return <div style={{ width: 0, height: 0, borderLeft: `12px solid ${color}`, borderTop: "7px solid transparent", borderBottom: "7px solid transparent", marginLeft: 3 }} />;
}

function PauseGlyph({ color }) {
  return (
    <div style={{ display: "flex", gap: 3 }}>
      <div style={{ width: 4, height: 14, background: color, borderRadius: 1 }} />
      <div style={{ width: 4, height: 14, background: color, borderRadius: 1 }} />
    </div>
  );
}
