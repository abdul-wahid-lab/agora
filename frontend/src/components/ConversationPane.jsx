import { useEffect, useRef, useState } from "react";
import { api, connectEvents } from "../api";
import { paletteFor, initials } from "../lib/avatar";
import SecurityGate from "./SecurityGate";
import FileOpenActions from "./FileOpenActions";
import ImagePreview from "./ImagePreview";
import { isImageFile, EXECUTABLE_EXTS, extStyle, formatFileSize as formatSize } from "../lib/fileTypes";
import { usePeers } from "../hooks/usePeers";

function statusGlyph(status) {
  if (status === "delivered" || status === "received") return "✓✓";
  if (status === "failed") return "!";
  if (status === "sent") return "✓";
  return "…";
}

function dayLabel(ts) {
  const d = new Date(ts * 1000);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return isToday ? `TODAY · ${time}` : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${time}`;
}

// Matches design screen 10.7's conversation pane exactly: header with
// presence-ring avatar + Call/Video/Files actions, a merged thread of text
// and file bubbles (received = white bordered, sent = accent filled), and a
// composer bar. Text and file "messages" come from two different backend
// stores (see storage.py) but read as one timeline here, sorted by time -
// that interleaving is what the design shows, even though the underlying
// APIs stay separate.
export default function ConversationPane({ peer, online = true, onOpenCall, emptyState }) {
  const [messages, setMessages] = useState([]);
  const [files, setFiles] = useState([]);
  const [progressByTransfer, setProgressByTransfer] = useState({});
  const [draft, setDraft] = useState("");
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [filePath, setFilePath] = useState("");
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const hasNativePicker = Boolean(window.electronAPI?.pickFile);
  const [gateFile, setGateFile] = useState(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const { peers: livePeers } = usePeers();
  const bottomRef = useRef(null);
  const peerIdRef = useRef(peer?.peer_id);
  peerIdRef.current = peer?.peer_id;

  useEffect(() => {
    if (!peer) return;
    let cancelled = false;
    async function load() {
      try {
        const [msgs, fls] = await Promise.all([api.history(peer.peer_id), api.files(peer.peer_id)]);
        if (!cancelled) {
          setMessages(msgs);
          setFiles(fls);
        }
      } catch {
        // ignore - next poll retries
      }
    }
    load();
    const interval = setInterval(load, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [peer?.peer_id]);

  useEffect(() => {
    const stop = connectEvents((evt) => {
      const current = peerIdRef.current;
      if (evt.type === "message" && evt.peer_id === current) {
        setMessages((prev) => [...prev, { msg_id: `live-${evt.ts}`, direction: "received", body: evt.body, status: "received", ts: evt.ts }]);
      }
      if (evt.type === "message_deleted" && evt.peer_id === current) {
        setMessages((prev) => prev.filter((m) => m.msg_id !== evt.msg_id));
      }
      if (evt.type === "file_progress") {
        setProgressByTransfer((prev) => ({ ...prev, [evt.transfer_id]: evt.bytes_sent / evt.total }));
      }
      if ((evt.type === "file_offer" || evt.type === "file_status") && current) {
        api.files(current).then(setFiles).catch(() => {});
      }
    });
    return stop;
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, files]);

  if (!peer) {
    if (emptyState) return emptyState;
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)" }}>
        <p className="serif" style={{ fontSize: 22 }}>
          Pick someone to start talking to
        </p>
      </div>
    );
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const optimistic = { msg_id: `pending-${Date.now()}`, direction: "sent", body: text, status: "pending", ts: Date.now() / 1000 };
    setMessages((prev) => [...prev, optimistic]);
    try {
      await api.sendMessage(peer.peer_id, text);
    } catch {
      setMessages((prev) => prev.map((m) => (m.msg_id === optimistic.msg_id ? { ...m, status: "failed" } : m)));
    }
  }

  // A "failed" message never reached the backend (the POST itself threw),
  // so there's no msg_id to retry against server-side - this just re-runs
  // the same send against the same local optimistic entry. If it works this
  // time, the next history poll replaces it with the real persisted message
  // from the backend, same as a normal send.
  async function handleRetryMessage(msg) {
    setMessages((prev) => prev.map((m) => (m.msg_id === msg.msg_id ? { ...m, status: "pending" } : m)));
    try {
      await api.sendMessage(peer.peer_id, msg.body);
    } catch {
      setMessages((prev) => prev.map((m) => (m.msg_id === msg.msg_id ? { ...m, status: "failed" } : m)));
    }
  }

  // "Delete for me": local-only removal of this device's own copy, nothing
  // goes over the wire. "Delete for everyone" (only ever offered on a
  // message you sent) also best-effort notifies the peer - if they're
  // offline right now the backend queues it and delivers automatically once
  // they reappear (deletion.py's flush loop), same guarantee a normal chat
  // message already has. Optimistic removal from local state either way -
  // if the DELETE somehow fails, the next history poll (2.5s) just brings
  // it back rather than the UI silently lying about the outcome.
  function handleDeleteMessage(msg, everyone = false) {
    setMessages((prev) => prev.filter((m) => m.msg_id !== msg.msg_id));
    api.deleteMessage(msg.msg_id, { everyone, peerId: peer.peer_id }).catch(() => {});
  }

  function handleClearConversation() {
    setHeaderMenuOpen(false);
    if (!window.confirm(`Clear your entire chat history with ${peer.name}? This only clears it on this device, it can't be undone.`)) return;
    setMessages([]);
    api.clearConversation(peer.peer_id).catch(() => {});
  }

  // Anyone else currently discoverable, excluding this same conversation -
  // forwarding to a currently-offline peer isn't offered here since there's
  // no picker feedback for "queued, will send later" yet; unlike a plain
  // send from the composer, a forward with no visible confirmation that
  // silently queued would be confusing.
  const forwardCandidates = livePeers.filter((p) => p.peer_id !== peer.peer_id);

  function handleForwardMessage(msg, targetPeerId) {
    api.sendMessage(targetPeerId, msg.body).catch(() => {});
  }

  function handleForwardFile(file, targetPeerId) {
    // Only ever offered for a received, completed file - that's the only
    // case with a real local saved_path to re-send from. A file you sent
    // has no path recorded anywhere the frontend can see (see
    // filetransfer.py: saved_path is only ever set on the receiving side).
    api.sendFile(targetPeerId, file.saved_path).catch(() => {});
  }

  async function sendFileAtPath(path) {
    if (!path) return;
    try {
      await api.sendFile(peer.peer_id, path);
      setTimeout(() => api.files(peer.peer_id).then(setFiles).catch(() => {}), 400);
    } catch {
      // the composer's own error surface is intentionally minimal here;
      // FilesScreen has the fuller accept/decline/executable-warning flow
    }
  }

  function refreshFiles() {
    api.files(peer.peer_id).then(setFiles).catch(() => {});
  }

  function handleAcceptClick(file) {
    if (EXECUTABLE_EXTS.has((file.filename.split(".").pop() || "").toLowerCase())) {
      setGateFile(file);
    } else {
      api.acceptFile(file.transfer_id).then(refreshFiles);
    }
  }

  function handleDeclineClick(file) {
    api.declineFile(file.transfer_id).then(refreshFiles);
  }

  function handleRetryClick(file) {
    // Fire-and-forget on the backend (see api.py's resend_file): it kicks
    // off a background task and returns immediately, so there's no direct
    // success/failure to await here. If the retry actually works, the next
    // poll of refreshFiles picks up "transferring" -> "completed"; if the
    // original file path is gone (backend restarted since it was first
    // sent), it silently stays "failed" and the button is just still there.
    api.resendFile(file.transfer_id).then(refreshFiles).catch(() => {});
  }

  async function handleSendFile() {
    const path = filePath.trim();
    setFilePickerOpen(false);
    setFilePath("");
    await sendFileAtPath(path);
  }

  async function handlePickFile(category) {
    setAttachMenuOpen(false);
    const path = await window.electronAPI.pickFile(category);
    await sendFileAtPath(path);
  }

  const { bg, text } = paletteFor(peer.peer_id);
  const timeline = [
    ...messages.map((m) => ({ kind: "message", ts: m.ts, data: m })),
    ...files.map((f) => ({ kind: "file", ts: f.ts, data: f })),
  ].sort((a, b) => a.ts - b.ts);

  let lastDay = null;

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--ground)", position: "relative" }}>
      <div style={{ flex: "0 0 auto", height: 62, borderBottom: "1px solid var(--divider)", background: "var(--panel)", display: "flex", alignItems: "center", gap: 13, padding: "0 20px" }}>
        <span style={{ position: "relative", width: 38, height: 38, flexShrink: 0 }}>
          <span style={{ position: "absolute", inset: -3, borderRadius: 99, border: "2px solid var(--accent)", animation: "agRing 2.6s ease-out infinite" }} />
          <span style={{ width: 38, height: 38, borderRadius: 99, background: bg, color: text, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600 }}>
            {initials(peer.name)}
          </span>
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15.5 }}>{peer.name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: online ? "var(--accent)" : "var(--text-3)" }} />
            {/* NOT "encrypted" - the P2P WebSocket is plain ws://, no
                transport encryption exists yet (see BUILD_LOG's Security
                posture section). Don't claim a protection that isn't real. */}
            <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>
              {online ? "On this network · direct, device-to-device" : "Not on this network right now · showing saved history"}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => onOpenCall(peer.peer_id, "audio")} disabled={!online} title={online ? undefined : "Not reachable right now"} style={{ ...pillButtonStyle, opacity: online ? 1 : 0.5 }}>
            Call
          </button>
          <button onClick={() => onOpenCall(peer.peer_id, "video")} disabled={!online} title={online ? undefined : "Not reachable right now"} style={{ ...pillButtonStyle, opacity: online ? 1 : 0.5 }}>
            Video
          </button>
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setHeaderMenuOpen((v) => !v)}
              style={{ width: 34, height: 34, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: "var(--text-muted)" }}
            >
              ⋯
            </button>
            {headerMenuOpen && (
              <div style={{ position: "absolute", top: 40, right: 0, zIndex: 20, minWidth: 200, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border-soft)", boxShadow: "var(--shadow)", padding: 6 }}>
                <button
                  onClick={handleClearConversation}
                  style={{ width: "100%", textAlign: "left", padding: "9px 11px", borderRadius: 9, background: "transparent", border: "none", fontSize: 13, fontWeight: 600, color: "var(--danger)" }}
                >
                  Clear chat history
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 24px", display: "flex", flexDirection: "column", gap: 11 }}>
        {timeline.length === 0 && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)", fontSize: 14 }}>
            No messages yet - say hello.
          </div>
        )}
        {timeline.map((item) => {
          const day = dayLabel(item.ts);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={item.kind === "message" ? item.data.msg_id : item.data.transfer_id} style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {showDay && (
                <div style={{ alignSelf: "center", font: '500 10.5px/1 "IBM Plex Mono", monospace', color: "var(--text-3)", padding: "5px 11px", borderRadius: 99, background: "var(--surface-2)" }}>
                  {day}
                </div>
              )}
              {item.kind === "message" ? (
                <MessageBubble
                  msg={item.data}
                  onRetry={() => handleRetryMessage(item.data)}
                  onDelete={(everyone) => handleDeleteMessage(item.data, everyone)}
                  forwardCandidates={forwardCandidates}
                  onForward={(targetPeerId) => handleForwardMessage(item.data, targetPeerId)}
                />
              ) : (
                <FileBubble
                  file={item.data}
                  progress={progressByTransfer[item.data.transfer_id]}
                  onAccept={() => handleAcceptClick(item.data)}
                  onDecline={() => handleDeclineClick(item.data)}
                  onRetry={() => handleRetryClick(item.data)}
                  forwardCandidates={forwardCandidates}
                  onForward={(targetPeerId) => handleForwardFile(item.data, targetPeerId)}
                />
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {gateFile && (
        <SecurityGate
          file={gateFile}
          peerName={peer.name}
          onClose={() => setGateFile(null)}
          onAccept={() => {
            api.acceptFile(gateFile.transfer_id).then(refreshFiles);
            setGateFile(null);
          }}
          onDecline={() => {
            api.declineFile(gateFile.transfer_id).then(refreshFiles);
            setGateFile(null);
          }}
        />
      )}

      {filePickerOpen && (
        <div style={{ padding: "0 20px 8px", display: "flex", gap: 8 }}>
          <input
            autoFocus
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSendFile();
              if (e.key === "Escape") setFilePickerOpen(false);
            }}
            placeholder="Full path to a file on this machine"
            style={{ flex: 1, height: 38, borderRadius: 12, border: "1px solid var(--border)", padding: "0 13px", fontSize: 13.5, fontFamily: '"IBM Plex Mono", monospace' }}
          />
          <button onClick={handleSendFile} style={pillButtonStyle}>
            Send file
          </button>
        </div>
      )}

      <div style={{ flex: "0 0 auto", padding: "12px 20px 16px", borderTop: "1px solid var(--divider)", background: "var(--panel)", display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
        {attachMenuOpen && (
          <div
            style={{
              position: "absolute",
              bottom: "calc(100% + 8px)",
              left: 20,
              width: 200,
              borderRadius: 14,
              background: "var(--panel)",
              border: "1px solid var(--border)",
              boxShadow: "0 14px 32px rgba(20,14,10,0.18)",
              padding: 6,
              display: "flex",
              flexDirection: "column",
              gap: 2,
              zIndex: 20,
            }}
          >
            <AttachMenuItem label="Photos & Videos" onClick={() => handlePickFile("media")} />
            <AttachMenuItem label="Document" onClick={() => handlePickFile("document")} />
            <AttachMenuItem label="Any file" onClick={() => handlePickFile("any")} />
          </div>
        )}
        <button
          onClick={() => (hasNativePicker ? setAttachMenuOpen((v) => !v) : setFilePickerOpen((v) => !v))}
          style={{ width: 38, height: 38, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "var(--text-muted)" }}
        >
          +
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSend();
          }}
          placeholder={`Message ${peer.name}, or drop a file anywhere in this window`}
          style={{ flex: 1, height: 42, borderRadius: 14, border: "1px solid var(--border)", padding: "0 15px", fontSize: 14 }}
        />
        <button
          onClick={handleSend}
          disabled={!draft.trim()}
          style={{ padding: "0 18px", height: 42, borderRadius: 14, border: "none", background: draft.trim() ? "var(--accent)" : "var(--border)", color: draft.trim() ? "#fff8f2" : "var(--text-3)", fontWeight: 600, fontSize: 14 }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

function AttachMenuItem({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{ textAlign: "left", padding: "9px 11px", borderRadius: 9, background: "transparent", border: "none", fontSize: 13.5, fontWeight: 500, color: "var(--text-strong)", cursor: "pointer" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {label}
    </button>
  );
}

const pillButtonStyle = {
  padding: "8px 13px",
  borderRadius: 12,
  background: "var(--surface)",
  border: "1px solid var(--border)",
  fontSize: 12.5,
  fontWeight: 600,
  color: "var(--text-strong)",
};

function MessageBubble({ msg, onRetry, onDelete, forwardCandidates, onForward }) {
  const sent = msg.direction === "sent";
  const failed = msg.status === "failed";
  const [menuOpen, setMenuOpen] = useState(false);
  // Messages fresh off a live WS event, or an optimistic just-sent bubble,
  // only have a synthetic local id ("live-"/"pending-") - the real
  // backend msg_id isn't in that event payload at all (see messaging.py's
  // "message" broadcast). Deleting against a synthetic id would delete
  // nothing server-side, and the real row would just reappear on the next
  // history poll, so the delete affordance only shows once this message
  // has a real id (within ~2.5s, after the next poll picks it up).
  const isSynthetic = msg.msg_id.startsWith("live-") || msg.msg_id.startsWith("pending-");

  const deleteButton = !isSynthetic && (
    <div style={{ position: "relative" }}>
      <button onClick={() => setMenuOpen((v) => !v)} title="Delete" style={deleteGlyphStyle}>
        🗑
      </button>
      {menuOpen && (
        <div
          style={{
            position: "absolute",
            top: 24,
            [sent ? "right" : "left"]: 0,
            zIndex: 20,
            minWidth: 168,
            borderRadius: 12,
            background: "var(--surface)",
            border: "1px solid var(--border-soft)",
            boxShadow: "var(--shadow)",
            padding: 6,
          }}
        >
          <button
            onClick={() => {
              setMenuOpen(false);
              onDelete(false);
            }}
            style={{ width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 8, background: "transparent", border: "none", fontSize: 12.5, fontWeight: 600, color: "var(--text-strong)" }}
          >
            Delete for me
          </button>
          {/* Only ever offered on your own sent message - deleting someone
              else's message "for everyone" would mean telling them to
              delete something from their own device, not a real feature. */}
          {sent && (
            <button
              onClick={() => {
                setMenuOpen(false);
                onDelete(true);
              }}
              style={{ width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 8, background: "transparent", border: "none", fontSize: 12.5, fontWeight: 600, color: "var(--danger)" }}
            >
              Delete for everyone
            </button>
          )}
        </div>
      )}
    </div>
  );

  const bubbleActions = (
    <div style={{ display: "flex", gap: 1 }}>
      {deleteButton}
      <ForwardMenu candidates={forwardCandidates} onPick={onForward} align={sent ? "right" : "left"} />
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: sent ? "flex-end" : "flex-start", gap: 4, maxWidth: "58%", alignSelf: sent ? "flex-end" : "flex-start" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
        {!sent && bubbleActions}
        <div
          style={{
            padding: "11px 15px",
            borderRadius: sent ? "18px 18px 5px 18px" : "18px 18px 18px 5px",
            background: sent ? "var(--accent)" : "var(--surface)",
            border: sent ? "none" : "1px solid var(--border-soft)",
            color: sent ? "#fff8f2" : "var(--text)",
            fontSize: 14.5,
            lineHeight: 1.45,
            wordBreak: "break-word",
          }}
        >
          {msg.body}
        </div>
        {sent && bubbleActions}
      </div>
      {sent && !failed && (
        <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 500 }}>
          {statusGlyph(msg.status)} {msg.status === "delivered" ? "Seen" : ""}
        </div>
      )}
      {sent && failed && (
        <button
          onClick={onRetry}
          style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", padding: 0, fontSize: 11, fontWeight: 700, color: "var(--danger)" }}
          title="Message failed to send. Click to retry."
        >
          ! Failed, tap to retry
        </button>
      )}
    </div>
  );
}

const deleteGlyphStyle = {
  flexShrink: 0,
  width: 22,
  height: 22,
  borderRadius: 8,
  background: "transparent",
  border: "none",
  fontSize: 11,
  opacity: 0.45,
  color: "var(--text-3)",
};

// Shared by MessageBubble and FileBubble. Only ever offered for a message
// (any direction) or a completed, received file - see the two call sites'
// own comments for why sent files aren't included. Deliberately doesn't
// list a currently-offline peer: unlike a normal send from the composer,
// there'd be no visible confirmation that a forward silently queued, which
// would just look like it went nowhere.
function ForwardMenu({ candidates, onPick, align = "right" }) {
  const [open, setOpen] = useState(false);
  const disabled = candidates.length === 0;
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        title={disabled ? "No one else on this network to forward to" : "Forward"}
        style={{ ...deleteGlyphStyle, opacity: disabled ? 0.22 : 0.45, cursor: disabled ? "default" : "pointer" }}
      >
        ↪
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: 24,
            [align]: 0,
            zIndex: 20,
            minWidth: 180,
            maxHeight: 220,
            overflowY: "auto",
            borderRadius: 12,
            background: "var(--surface)",
            border: "1px solid var(--border-soft)",
            boxShadow: "var(--shadow)",
            padding: 6,
          }}
        >
          <div style={{ padding: "4px 10px 6px", font: '600 10px/1 "IBM Plex Mono", monospace', letterSpacing: "0.08em", color: "var(--text-3)" }}>
            FORWARD TO
          </div>
          {candidates.map((p) => (
            <button
              key={p.peer_id}
              onClick={() => {
                setOpen(false);
                onPick(p.peer_id);
              }}
              style={{ width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 8, background: "transparent", border: "none", fontSize: 12.5, fontWeight: 600, color: "var(--text-strong)" }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FileBubble({ file, progress, onAccept, onDecline, onRetry, forwardCandidates, onForward }) {
  const sent = file.direction === "sent";
  const { bg, text } = extStyle(file.filename);
  const isExecutable = EXECUTABLE_EXTS.has((file.filename.split(".").pop() || "").toLowerCase());
  const inProgress = file.status === "transferring" || file.status === "accepted";
  const pending = !sent && file.status === "awaiting_accept";
  // Resend only exists for outgoing transfers (see filetransfer.py's
  // resend(): it raises if direction isn't "sent"), so a failed received
  // file has no retry path from this side, only the sender can retry.
  const failed = sent && file.status === "failed";
  // Forwarding only works from a real local saved_path, which only ever
  // exists on the receiving side (filetransfer.py never records one for a
  // sent file). A file you sent can't be forwarded from here.
  const canForward = !sent && file.status === "completed" && Boolean(file.saved_path);
  const [imagePreviewFailed, setImagePreviewFailed] = useState(false);
  const showImagePreview = isImageFile(file.filename) && Boolean(file.saved_path) && !imagePreviewFailed;

  if (sent && inProgress) {
    const pct = Math.round((progress || 0) * 100);
    return (
      <div style={{ maxWidth: "58%", alignSelf: "flex-end", width: "58%" }}>
        <div style={{ padding: "11px 13px", borderRadius: "18px 18px 5px 18px", background: "var(--accent)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <span style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 12, background: "rgba(255,248,242,0.2)", display: "flex", alignItems: "center", justifyContent: "center", font: '600 9px/1 "IBM Plex Mono", monospace', color: "#fff8f2" }}>
              {(file.filename.split(".").pop() || "").slice(0, 3).toUpperCase()}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: "#fff8f2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.filename}</div>
              <div className="mono" style={{ fontSize: 11, color: "#fbdcc8" }}>{formatSize(file.size)}</div>
            </div>
          </div>
          <div style={{ height: 6, borderRadius: 99, background: "rgba(255,248,242,0.28)", overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: 6, borderRadius: 99, background: "#fff8f2" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", font: '500 11px/1 "IBM Plex Mono", monospace', color: "#fbdcc8" }}>
            <span>{pct}% · sending</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "58%", alignSelf: sent ? "flex-end" : "flex-start" }}>
      <div
        style={{
          padding: "11px 13px",
          borderRadius: sent ? "18px 18px 5px 18px" : "18px 18px 18px 5px",
          background: "var(--surface)",
          border: isExecutable ? "1.5px solid var(--danger)" : "1px solid var(--border-soft)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {/* WhatsApp-style: a downloaded image shows the actual photo, not
            a generic file icon. Sent images don't get this - saved_path is
            never recorded for anything you sent (see FileOpenActions'
            same limitation just above), only what you've received. */}
        {showImagePreview ? (
          <>
            <ImagePreview filePath={file.saved_path} filename={file.filename} onFail={() => setImagePreviewFailed(true)} />
            <div className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {file.filename} · {formatSize(file.size)}
            </div>
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <span style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 12, background: bg, display: "flex", alignItems: "center", justifyContent: "center", font: '600 9.5px/1 "IBM Plex Mono", monospace', color: text }}>
              {(file.filename.split(".").pop() || "").slice(0, 3).toUpperCase()}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 7 }}>
                {file.filename}
                {isExecutable && (
                  <span style={{ padding: "2px 7px", borderRadius: 99, background: "#f9e3de", font: '600 9.5px/1.3 "Hanken Grotesk", sans-serif', color: "#a83f30", flexShrink: 0 }}>Installable</span>
                )}
              </div>
              <div className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {formatSize(file.size)} · {file.status}
              </div>
            </div>
          </div>
        )}
        {pending && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onDecline} style={{ flex: 1, padding: "8px 0", borderRadius: 10, background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 12.5, fontWeight: 600 }}>
              Decline
            </button>
            <button onClick={onAccept} style={{ flex: 1, padding: "8px 0", borderRadius: 10, background: "var(--accent)", border: "none", color: "#fff8f2", fontSize: 12.5, fontWeight: 700 }}>
              Accept
            </button>
          </div>
        )}
        {failed && (
          <button onClick={onRetry} style={{ padding: "8px 0", borderRadius: 10, background: "transparent", border: "1px solid var(--danger)", color: "var(--danger)", fontSize: 12.5, fontWeight: 700 }}>
            Retry send
          </button>
        )}
        {file.saved_path && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <FileOpenActions file={file} />
            {canForward && (
              <>
                <div style={{ flex: 1 }} />
                <ForwardMenu candidates={forwardCandidates} onPick={onForward} align="right" />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
