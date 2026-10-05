import { useEffect, useState } from "react";
import { api } from "../api";
import { usePeers } from "../hooks/usePeers";
import { paletteFor, initials } from "../lib/avatar";

export function fmtDuration(seconds) {
  if (seconds == null) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m} min ${s.toString().padStart(2, "0")} s` : `${s} s`;
}

function fmtWhen(ts) {
  const d = new Date(ts * 1000);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yest.";
  return d.toLocaleDateString([], { weekday: "short" });
}

export function summaryLine(call) {
  const media = call.media === "video" ? "Video" : "Audio";
  if (call.status === "missed") return call.direction === "incoming" ? `Missed ${media.toLowerCase()} call` : `${media} · no answer`;
  if (call.status === "declined") return `${media} · declined`;
  if (call.status === "dropped") return `${media} · ${fmtDuration(call.duration)} · dropped, connection lost`;
  if (call.status === "busy") return `${media} · busy`;
  if (call.status === "collision") return `Missed ${media.toLowerCase()} call`;
  return `${media} · ${fmtDuration(call.duration)} · local, direct`;
}

// Matches design screen 10.4: the Calls tab is a call-history list, not a
// peer picker - placing a call happens from a conversation's Call/Video
// buttons (see ConversationPane). This just reviews what already happened
// and offers a one-click callback/redial.
const PAGE_SIZE = 50;

export default function CallsScreen({ onPlaceCall, filterPeerId, onClearPeerFilter }) {
  const { peers } = usePeers();
  const [history, setHistory] = useState([]);
  const [filter, setFilter] = useState("all");
  // Always re-fetches the whole [0, limit) window rather than tracking a
  // separate offset - "Load more" just grows this, and the existing 4s live
  // poll keeps refreshing that same growing window (picking up new calls
  // and status changes) without a second, harder-to-reconcile code path for
  // "paginated" vs "live" loading.
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Conversation menu's "View Call History with this Peer" uses the
        // real dedicated per-peer endpoint instead of client-side filtering
        // the combined list, so it isn't capped by whatever the combined
        // list's own pagination window happens to be loaded to right now.
        const list = filterPeerId ? await api.callHistory(filterPeerId) : await api.allCallHistory(limit);
        if (!cancelled) {
          setHistory(list);
          setLoadingMore(false);
        }
      } catch {
        // ignore - next poll retries
      }
    }
    load();
    const interval = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [limit, filterPeerId]);

  // A full page came back, so there may be older calls beyond this window -
  // the backend has no separate "total count" endpoint, this is the same
  // "did we get a full page" signal any offset-based pager relies on.
  const mayHaveMore = !filterPeerId && history.length >= limit;

  function handleLoadMore() {
    setLoadingMore(true);
    setLimit((l) => l + PAGE_SIZE);
  }

  const peerName = (peerId) => peers.find((p) => p.peer_id === peerId)?.name || "Unknown";

  function handleClearAll() {
    if (!window.confirm("Clear your entire call history? This can't be undone.")) return;
    setHistory([]);
    setLimit(PAGE_SIZE);
    api.clearCallHistory().catch(() => {});
  }

  const filtered = history.filter((c) => {
    if (filter === "missed") return c.status === "missed" || c.status === "collision";
    return true;
  });

  const totalSeconds = history.reduce((sum, c) => sum + (c.duration || 0), 0);
  const totalHours = Math.floor(totalSeconds / 3600);
  const totalMins = Math.floor((totalSeconds % 3600) / 60);

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: "22px 26px", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="serif" style={{ fontSize: 30, lineHeight: 1 }}>
            Calls
          </div>
          {filterPeerId && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 6px 5px 12px", borderRadius: 99, background: "var(--surface-2)", fontSize: 12, fontWeight: 600 }}>
              With {peerName(filterPeerId)}
              <button onClick={onClearPeerFilter} style={{ width: 20, height: 20, borderRadius: 99, background: "transparent", border: "none", fontSize: 11, color: "var(--text-muted)" }}>
                ✕
              </button>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {["all", "missed"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "8px 13px",
                borderRadius: 11,
                background: filter === f ? "#2a2320" : "var(--surface)",
                border: filter === f ? "none" : "1px solid var(--border)",
                color: filter === f ? "var(--surface)" : "var(--text-strong)",
                fontSize: 12.5,
                fontWeight: 600,
                textTransform: "capitalize",
              }}
            >
              {f}
            </button>
          ))}
          {history.length > 0 && (
            <button
              onClick={handleClearAll}
              style={{ padding: "8px 13px", borderRadius: 11, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--danger)", fontSize: 12.5, fontWeight: 600 }}
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: 18 }}>
        {filtered.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13.5 }}>No calls yet.</div>}
        {filtered.map((c) => {
          const { bg, text } = paletteFor(c.peer_id);
          const isMissed = c.status === "missed" || c.status === "collision";
          return (
            <div key={c.call_id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", borderBottom: "1px solid var(--divider)" }}>
              <span style={{ width: 42, height: 42, flexShrink: 0, borderRadius: 99, background: bg, color: text, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 600 }}>
                {initials(peerName(c.peer_id))}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: isMissed ? "var(--danger)" : "var(--text)" }}>{peerName(c.peer_id)}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{summaryLine(c)}</div>
              </div>
              <div className="mono" style={{ fontSize: 11.5, color: "var(--text-3)", width: 70, textAlign: "right" }}>
                {fmtWhen(c.started_at)}
              </div>
              <div style={{ display: "flex", gap: 7 }}>
                <button onClick={() => onPlaceCall(c.peer_id, "audio")} style={smallBtnStyle}>
                  {isMissed ? "Call back" : "Call"}
                </button>
                {!isMissed && (
                  <button onClick={() => onPlaceCall(c.peer_id, "video")} style={smallBtnStyle}>
                    Video
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {mayHaveMore && (
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            style={{ padding: "12px 0", background: "transparent", border: "none", borderTop: filtered.length > 0 ? "1px solid var(--divider)" : "none", color: "var(--text-2)", fontSize: 12.5, fontWeight: 600, opacity: loadingMore ? 0.6 : 1 }}
          >
            {loadingMore ? "Loading…" : `Load ${PAGE_SIZE} more`}
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 14 }}>
        <div style={{ flex: 1, padding: 16, borderRadius: 18, background: "var(--surface)", border: "1px solid var(--border-soft)", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ font: '600 10.5px/1 "IBM Plex Mono", monospace', letterSpacing: "0.1em", color: "var(--text-3)" }}>THIS WEEK</div>
          <div className="serif" style={{ fontSize: 30, lineHeight: 1 }}>
            {totalHours > 0 ? `${totalHours} h ${totalMins} m` : `${totalMins} m`}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>All of it over the local network, zero internet bandwidth used.</div>
        </div>
        <div style={{ flex: 1, padding: 16, borderRadius: 18, background: "var(--surface-2)", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ font: '600 10.5px/1 "IBM Plex Mono", monospace', letterSpacing: "0.1em", color: "var(--text-3)" }}>CALLS</div>
          <div className="mono" style={{ fontSize: 11.5, lineHeight: 1.8, color: "var(--text-2)" }}>
            total &nbsp;&nbsp;&nbsp;&nbsp;{history.length}
            <br />
            missed &nbsp;&nbsp;{history.filter((c) => c.status === "missed" || c.status === "collision").length}
            <br />
            dropped &nbsp;{history.filter((c) => c.status === "dropped").length}
          </div>
        </div>
      </div>
    </div>
  );
}

const smallBtnStyle = {
  padding: "7px 12px",
  borderRadius: 10,
  background: "var(--surface-2)",
  border: "none",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text-strong)",
};
