import { useEffect, useRef, useState } from "react";
import { api, connectEvents } from "../api";
import { initials } from "../lib/avatar";
import { isImageFile, EXECUTABLE_EXTS, extStyle, formatFileSize as formatSize } from "../lib/fileTypes";
import SecurityGate from "./SecurityGate";
import FileOpenActions from "./FileOpenActions";
import ImagePreview from "./ImagePreview";
import ForwardMenu, { glyphStyle } from "./ForwardMenu";

// Must match backend/app/groups.py's MAX_GROUP_CALL_MEMBERS - kept here as
// a separate constant (not shared config between the two codebases) purely
// so the button can be disabled with a clear reason *before* even trying,
// the backend enforces the real limit regardless of what this checks.
const MAX_GROUP_CALL_MEMBERS = 4;

function dayLabel(ts) {
  const d = new Date(ts * 1000);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return isToday ? `TODAY · ${time}` : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${time}`;
}

// "Sending a file to a group" is really N independent 1:1 transfers under
// the hood (see groups.py's send_group_file), so the sender's own
// group_files() response has one row per recipient for the same logical
// send - collapsed here into a single bubble with an aggregate status,
// otherwise your own sent file would visually repeat once per person you
// sent it to.
function collapseSentCopies(files) {
  const sentGroups = new Map();
  const items = [];
  for (const f of files) {
    if (f.direction === "received") {
      items.push(f);
      continue;
    }
    const key = f.sha256;
    if (!sentGroups.has(key)) sentGroups.set(key, { ...f, recipients: [] });
    const agg = sentGroups.get(key);
    agg.recipients.push(f);
    if (f.ts < agg.ts) agg.ts = f.ts;
  }
  return [...items, ...sentGroups.values()];
}

// Reuses ConversationPane's whole file-transfer/image-preview/security-gate
// machinery (all already generic, none of it was actually 1:1-specific),
// group chat only adds the sender-name label and the sent-copy collapsing
// above - no new transfer protocol, no new safety logic.
export default function GroupConversationPane({ group, onlineCount, onStartCall, me, livePeers = [], otherGroups = [] }) {
  const [messages, setMessages] = useState([]);
  const [files, setFiles] = useState([]);
  const [draft, setDraft] = useState("");
  const [gateFile, setGateFile] = useState(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [filePath, setFilePath] = useState("");
  const hasNativePicker = Boolean(window.electronAPI?.pickFile);
  const bottomRef = useRef(null);
  const groupIdRef = useRef(group?.group_id);
  groupIdRef.current = group?.group_id;

  function memberName(peerId) {
    return group?.members.find((m) => m.peer_id === peerId)?.name || "Unknown";
  }

  function refreshFiles() {
    if (!group) return;
    api.groupFiles(group.group_id).then(setFiles).catch(() => {});
  }

  useEffect(() => {
    if (!group) return;
    let cancelled = false;
    async function load() {
      try {
        const [msgs, fls] = await Promise.all([api.groupHistory(group.group_id), api.groupFiles(group.group_id)]);
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
  }, [group?.group_id]);

  useEffect(() => {
    const stop = connectEvents((evt) => {
      const current = groupIdRef.current;
      if (evt.type === "group_message" && evt.group_id === current) {
        setMessages((prev) => (prev.some((m) => m.msg_id === evt.msg_id) ? prev : [...prev, evt]));
      }
      if (evt.type === "group_message_deleted" && evt.group_id === current) {
        setMessages((prev) => prev.filter((m) => m.msg_id !== evt.msg_id));
      }
      if ((evt.type === "file_offer" || evt.type === "file_status") && evt.group_id === current) {
        refreshFiles();
      }
    });
    return stop;
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, files]);

  if (!group) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)" }}>
        <p className="serif" style={{ fontSize: 22 }}>
          Pick a group to start talking
        </p>
      </div>
    );
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    try {
      await api.sendGroupMessage(group.group_id, text);
    } catch {
      // minimal error surface, matches ConversationPane's own composer
    }
  }

  async function sendFileAtPath(path) {
    if (!path) return;
    try {
      await api.sendGroupFile(group.group_id, path);
      setTimeout(refreshFiles, 400);
    } catch {
      // same minimal error surface as the 1:1 composer
    }
  }

  async function handlePickFile(category) {
    setAttachMenuOpen(false);
    const path = await window.electronAPI.pickFile(category);
    await sendFileAtPath(path);
  }

  async function handleSendFilePath() {
    const path = filePath.trim();
    setFilePickerOpen(false);
    setFilePath("");
    await sendFileAtPath(path);
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
    const failedTransferIds = file.recipients ? file.recipients.filter((r) => r.status === "failed").map((r) => r.transfer_id) : [file.transfer_id];
    Promise.all(failedTransferIds.map((id) => api.resendFile(id).catch(() => {}))).then(refreshFiles);
  }

  function handleDeleteMessage(msg, everyone) {
    setMessages((prev) => prev.filter((m) => m.msg_id !== msg.msg_id));
    api.deleteGroupMessage(group.group_id, msg.msg_id, { everyone }).catch(() => {});
  }

  // Everyone else on this network plus every other group this device is
  // in - same shape and same "no currently-offline peer listed" reasoning
  // as ConversationPane's own forwardCandidates, just also excluding this
  // group itself (forwarding a message back into its own timeline isn't a
  // real action).
  const forwardCandidates = [
    ...livePeers.map((p) => ({ id: p.peer_id, name: p.name, kind: "peer" })),
    ...otherGroups.map((g) => ({ id: g.group_id, name: g.name, kind: "group" })),
  ];

  function handleForwardMessage(msg, target) {
    if (target.kind === "group") api.sendGroupMessage(target.id, msg.body).catch(() => {});
    else api.sendMessage(target.id, msg.body).catch(() => {});
  }

  function handleForwardFile(file, target) {
    // Same restriction as ConversationPane's own handleForwardFile: only a
    // received, completed file has a real local saved_path to re-send from.
    if (target.kind === "group") api.sendGroupFile(target.id, file.saved_path).catch(() => {});
    else api.sendFile(target.id, file.saved_path).catch(() => {});
  }

  const callDisabled = group.members.length > MAX_GROUP_CALL_MEMBERS;

  async function handleStartCall(media) {
    if (callDisabled) return;
    const res = await onStartCall(media);
    if (res?.status === "failed") window.alert(res.reason || "Couldn't start the group call.");
  }

  const timeline = [...messages.map((m) => ({ kind: "message", ts: m.ts, data: m })), ...collapseSentCopies(files).map((f) => ({ kind: "file", ts: f.ts, data: f }))].sort((a, b) => a.ts - b.ts);

  let lastDay = null;

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--ground)" }}>
      <div style={{ flex: "0 0 auto", height: 62, borderBottom: "1px solid var(--divider)", background: "var(--panel)", display: "flex", alignItems: "center", gap: 13, padding: "0 20px" }}>
        <span style={{ width: 38, height: 38, borderRadius: 12, background: "var(--avatar-self)", color: "var(--accent-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
          {initials(group.name)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15.5 }}>{group.name}</div>
          <div style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>
            {group.members.length} people{onlineCount != null ? ` · ${onlineCount} on this network right now` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => handleStartCall("audio")}
            disabled={callDisabled}
            title={callDisabled ? `Group calling is limited to ${MAX_GROUP_CALL_MEMBERS} people, this group has ${group.members.length}` : undefined}
            style={{ ...pillButtonStyle, opacity: callDisabled ? 0.5 : 1 }}
          >
            Call
          </button>
          <button
            onClick={() => handleStartCall("video")}
            disabled={callDisabled}
            title={callDisabled ? `Group calling is limited to ${MAX_GROUP_CALL_MEMBERS} people, this group has ${group.members.length}` : undefined}
            style={{ ...pillButtonStyle, opacity: callDisabled ? 0.5 : 1 }}
          >
            Video
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 24px", display: "flex", flexDirection: "column", gap: 11 }}>
        {timeline.length === 0 && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)", fontSize: 14 }}>
            No messages yet, say hello to the group.
          </div>
        )}
        {timeline.map((item) => {
          const day = dayLabel(item.ts);
          const showDay = day !== lastDay;
          lastDay = day;
          const key = item.kind === "message" ? item.data.msg_id : item.data.transfer_id;
          return (
            <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {showDay && (
                <div style={{ alignSelf: "center", font: '500 10.5px/1 "IBM Plex Mono", monospace', color: "var(--text-3)", padding: "5px 11px", borderRadius: 99, background: "var(--surface-2)" }}>
                  {day}
                </div>
              )}
              {item.kind === "message" ? (
                <GroupMessageBubble
                  msg={item.data}
                  isMine={item.data.sender_peer_id === me?.peer_id}
                  onDelete={(everyone) => handleDeleteMessage(item.data, everyone)}
                  forwardCandidates={forwardCandidates}
                  onForward={(target) => handleForwardMessage(item.data, target)}
                />
              ) : (
                <GroupFileBubble
                  file={item.data}
                  senderName={item.data.direction === "received" ? memberName(item.data.peer_id) : "You"}
                  onAccept={() => handleAcceptClick(item.data)}
                  onDecline={() => handleDeclineClick(item.data)}
                  onRetry={() => handleRetryClick(item.data)}
                  forwardCandidates={forwardCandidates}
                  onForward={(target) => handleForwardFile(item.data, target)}
                />
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div style={{ flex: "0 0 auto", padding: "12px 20px 16px", borderTop: "1px solid var(--divider)", background: "var(--panel)", display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
        {attachMenuOpen && (
          <div style={{ position: "absolute", bottom: 56, left: 20, zIndex: 20, minWidth: 180, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border-soft)", boxShadow: "var(--shadow)", padding: 6, display: "flex", flexDirection: "column", gap: 2 }}>
            <AttachMenuItem label="Photos & Videos" onClick={() => handlePickFile("media")} />
            <AttachMenuItem label="Document" onClick={() => handlePickFile("document")} />
            <AttachMenuItem label="Any file" onClick={() => handlePickFile("any")} />
          </div>
        )}
        <button
          onClick={() => (hasNativePicker ? setAttachMenuOpen((v) => !v) : setFilePickerOpen((v) => !v))}
          style={{ width: 38, height: 38, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "var(--text-muted)", flexShrink: 0 }}
        >
          +
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder={`Message ${group.name}`}
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

      {!hasNativePicker && filePickerOpen && (
        <div style={{ flex: "0 0 auto", padding: "10px 20px", borderTop: "1px solid var(--divider)", background: "var(--panel)", display: "flex", gap: 10 }}>
          <input
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            placeholder="Full path to a file on this machine"
            style={{ flex: 1, height: 38, borderRadius: 12, border: "1px solid var(--border)", padding: "0 13px", fontSize: 13.5, fontFamily: '"IBM Plex Mono", monospace' }}
          />
          <button onClick={handleSendFilePath} style={pillButtonStyle}>
            Send file
          </button>
        </div>
      )}

      {gateFile && (
        <SecurityGate
          file={gateFile}
          peerName={gateFile.direction === "received" ? memberName(gateFile.peer_id) : "someone in this group"}
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
    </div>
  );
}

// Group chat has no left/right "sent vs received" layout the way 1:1 chat
// does (a group message is never "yours" spatially, only ever attributed by
// the sender-name label) - delete/forward stay a small icon row next to the
// bubble rather than mirroring ConversationPane's alignment-flip.
function GroupMessageBubble({ msg, isMine, onDelete, forwardCandidates, onForward }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: "58%" }}>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-3)", paddingLeft: 2 }}>{msg.sender_name}</div>
        <div style={{ padding: "11px 15px", borderRadius: "18px 18px 18px 5px", background: "var(--surface)", border: "1px solid var(--border-soft)", fontSize: 14.5, lineHeight: 1.45, wordBreak: "break-word" }}>
          {msg.body}
        </div>
      </div>
      <div style={{ display: "flex", gap: 1, paddingBottom: 2 }}>
        <div style={{ position: "relative" }}>
          <button onClick={() => setMenuOpen((v) => !v)} title="Delete" style={glyphStyle}>
            🗑
          </button>
          {menuOpen && (
            <div style={{ position: "absolute", top: 24, left: 0, zIndex: 20, minWidth: 168, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border-soft)", boxShadow: "var(--shadow)", padding: 6 }}>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onDelete(false);
                }}
                style={{ width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 8, background: "transparent", border: "none", fontSize: 12.5, fontWeight: 600, color: "var(--text-strong)" }}
              >
                Delete for me
              </button>
              {/* Only ever offered on your own message - deleting someone
                  else's for everyone would mean telling them to remove
                  something from their own device, not a real feature. */}
              {isMine && (
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
        <ForwardMenu candidates={forwardCandidates} onPick={onForward} align="left" />
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

function GroupFileBubble({ file, senderName, onAccept, onDecline, onRetry, forwardCandidates, onForward }) {
  const sent = file.direction === "sent";
  const { bg, text } = extStyle(file.filename);
  const isExecutable = EXECUTABLE_EXTS.has((file.filename.split(".").pop() || "").toLowerCase());
  const pending = !sent && file.status === "awaiting_accept";
  const recipients = file.recipients || null; // only present on a collapsed sent-aggregate
  const failedCount = recipients ? recipients.filter((r) => r.status === "failed").length : file.status === "failed" ? 1 : 0;
  const completedCount = recipients ? recipients.filter((r) => r.status === "completed").length : file.status === "completed" ? 1 : 0;
  const totalCount = recipients ? recipients.length : 1;
  const [imagePreviewFailed, setImagePreviewFailed] = useState(false);
  // Same fallback as ConversationPane's FileBubble: a real read failure (no
  // Electron, oversized file) falls back to the generic icon row instead of
  // leaving a blank gap where the thumbnail should be.
  const showImage = !sent && isImageFile(file.filename) && Boolean(file.saved_path) && !imagePreviewFailed;
  // Same restriction as ConversationPane's own canForward: only a received,
  // completed file has a real local saved_path to re-send from.
  const canForward = !sent && file.status === "completed" && Boolean(file.saved_path);

  return (
    <div style={{ maxWidth: "58%", alignSelf: sent ? "flex-end" : "flex-start", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-3)", paddingLeft: 2, textAlign: sent ? "right" : "left" }}>{senderName}</div>
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
        {showImage ? (
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
                {formatSize(file.size)} · {sent ? `sent to ${totalCount} · ${completedCount} delivered${failedCount ? `, ${failedCount} failed` : ""}` : file.status}
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
        {sent && failedCount > 0 && (
          <button onClick={onRetry} style={{ padding: "8px 0", borderRadius: 10, background: "transparent", border: "1px solid var(--danger)", color: "var(--danger)", fontSize: 12.5, fontWeight: 700 }}>
            Retry failed ({failedCount})
          </button>
        )}
        {!sent && file.saved_path && (
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

const pillButtonStyle = {
  padding: "8px 13px",
  borderRadius: 12,
  background: "var(--surface)",
  border: "1px solid var(--border)",
  fontSize: 12.5,
  fontWeight: 600,
  color: "var(--text-strong)",
};
