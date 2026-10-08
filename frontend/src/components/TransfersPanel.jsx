import { useEffect, useState } from "react";
import { api, connectEvents } from "../api";
import { extStyle, formatFileSize } from "../lib/fileTypes";

function extOf(filename) {
  return (filename.split(".").pop() || "").toLowerCase();
}

function formatSpeed(bps) {
  if (!bps) return null;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatEta(sec) {
  if (sec == null) return null;
  if (sec < 60) return `${Math.ceil(sec)}s left`;
  return `${Math.ceil(sec / 60)}m left`;
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "declined"]);
const STATUS_LABEL = {
  offered: "Waiting for response",
  awaiting_accept: "Awaiting accept",
  accepted: "Starting…",
  transferring: "Transferring",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  declined: "Declined",
};
const STATUS_COLOR = {
  completed: { bg: "var(--accent-soft)", text: "var(--accent-strong)" },
  failed: { bg: "var(--danger-soft)", text: "var(--danger)" },
  cancelled: { bg: "var(--surface-2)", text: "var(--text-muted)" },
  declined: { bg: "var(--surface-2)", text: "var(--text-muted)" },
};

// The design reference's 10.8 dedicated Transfers panel: every active and
// recent transfer across every conversation and group at once (not just
// the one bubble you're looking at), with real speed/ETA for whatever's
// actively moving right now (see filetransfer.py's get_transfer_stats) and
// per-row cancel/retry/reveal-in-folder actions, plus one "Clear finished"
// action for the whole list.
export default function TransfersPanel() {
  const [transfers, setTransfers] = useState([]);

  function load() {
    api.transfers().then(setTransfers).catch(() => {});
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 2000);
    // Deliberately not file_progress here - that fires on every chunk, far
    // too often for a full re-fetch of every transfer; the 2s poll above
    // already keeps speed/ETA moving smoothly enough to watch.
    const stop = connectEvents((evt) => {
      if (evt.type === "file_offer" || evt.type === "file_status") load();
    });
    return () => {
      clearInterval(interval);
      stop();
    };
  }, []);

  const finishedCount = transfers.filter((t) => TERMINAL_STATUSES.has(t.status)).length;

  async function handleClearFinished() {
    const finished = transfers.filter((t) => TERMINAL_STATUSES.has(t.status));
    await Promise.all(finished.map((t) => api.deleteFile(t.transfer_id).catch(() => {})));
    load();
  }

  async function handleCancel(transferId) {
    await api.cancelTransfer(transferId).catch(() => {});
    load();
  }

  async function handleRetry(transferId) {
    await api.resendFile(transferId).catch(() => {});
    load();
  }

  function handleReveal(savedPath) {
    window.electronAPI?.showFileInFolder?.(savedPath);
  }

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: "0 0 auto", padding: "22px 26px 14px", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div className="serif" style={{ fontSize: 30, lineHeight: 1 }}>Transfers</div>
        <button
          onClick={handleClearFinished}
          disabled={finishedCount === 0}
          style={{ padding: "7px 13px", borderRadius: 10, background: "var(--surface-2)", border: "none", fontSize: 12.5, fontWeight: 600, color: finishedCount === 0 ? "var(--text-3)" : "var(--text-strong)" }}
        >
          Clear finished{finishedCount ? ` (${finishedCount})` : ""}
        </button>
      </div>

      <div style={{ margin: "0 26px 14px", padding: "10px 14px", borderRadius: 12, background: "var(--surface-2)", fontSize: 12, color: "var(--text-2)", lineHeight: 1.5 }}>
        Transfers run in this app's backend process, independent of which screen you're looking at. Closing this window now minimizes Agora to the tray rather than quitting it, so a transfer keeps running in the background - use the tray icon's own Quit action (or File → Exit) to actually close the app.
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 26px 20px" }}>
        {transfers.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13.5 }}>No transfers yet.</div>
        )}

        {transfers.map((t) => {
          const style = extStyle(t.filename);
          const isTerminal = TERMINAL_STATUSES.has(t.status);
          const isTransferring = t.status === "transferring" || t.status === "accepted";
          const canCancel = !isTerminal;
          const canRetry = t.direction === "sent" && t.status === "failed";
          const canReveal = t.direction === "received" && t.status === "completed" && Boolean(t.saved_path) && Boolean(window.electronAPI?.showFileInFolder);
          const statusColor = STATUS_COLOR[t.status] || { bg: "var(--surface-2)", text: "var(--text-muted)" };
          const speed = formatSpeed(t.speed_bps);
          const eta = formatEta(t.eta_sec);

          return (
            <div key={t.transfer_id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border-soft)", marginBottom: 8 }}>
              <span style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 11, background: style.bg, display: "flex", alignItems: "center", justifyContent: "center", font: '600 8.5px/1 "IBM Plex Mono", monospace', color: style.text }}>
                {extOf(t.filename).slice(0, 3).toUpperCase()}
              </span>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.filename}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {t.direction === "sent" ? "You → " : ""}
                  {t.group_name || t.peer_name}
                  {t.direction === "received" ? " → You" : ""} · {formatFileSize(t.size)}
                  {isTransferring && speed && ` · ${speed}`}
                  {isTransferring && eta && ` · ${eta}`}
                </div>
              </div>
              <span style={{ flexShrink: 0, padding: "4px 10px", borderRadius: 99, background: statusColor.bg, color: statusColor.text, fontSize: 11, fontWeight: 600 }}>
                {STATUS_LABEL[t.status] || t.status}
              </span>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {canReveal && (
                  <button onClick={() => handleReveal(t.saved_path)} style={{ padding: "6px 11px", borderRadius: 9, background: "var(--surface-2)", border: "none", fontSize: 11.5, fontWeight: 600, color: "var(--text-strong)" }}>
                    Reveal
                  </button>
                )}
                {canRetry && (
                  <button onClick={() => handleRetry(t.transfer_id)} style={{ padding: "6px 11px", borderRadius: 9, background: "var(--accent-soft)", border: "none", fontSize: 11.5, fontWeight: 600, color: "var(--accent-strong)" }}>
                    Retry
                  </button>
                )}
                {canCancel && (
                  <button onClick={() => handleCancel(t.transfer_id)} style={{ padding: "6px 11px", borderRadius: 9, background: "transparent", border: "1px solid var(--border)", fontSize: 11.5, fontWeight: 600, color: "var(--danger)" }}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
