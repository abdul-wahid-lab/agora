import { useEffect, useRef, useState } from "react";
import { api, connectEvents } from "../api";
import { initials, paletteFor } from "../lib/avatar";
import DropdownMenu from "./DropdownMenu";
import GroupMembersModal from "./GroupMembersModal";
import { isImageFile, isVideoFile, isVoiceMessage, EXECUTABLE_EXTS, extStyle, formatFileSize as formatSize } from "../lib/fileTypes";
import SecurityGate from "./SecurityGate";
import FileOpenActions from "./FileOpenActions";
import ImagePreview from "./ImagePreview";
import VideoPreview from "./VideoPreview";
import VoiceBubblePlayer from "./VoiceBubblePlayer";
import VoiceRecorder from "./VoiceRecorder";
import BubbleContextMenu, { useContextMenu } from "./BubbleContextMenu";

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
export default function GroupConversationPane({ group, onlineCount, onStartCall, me, livePeers = [], conversations = [], otherGroups = [], searchOpen = false, onCloseSearch, onOpenSearch, onExportConversation }) {
  const [membersModalOpen, setMembersModalOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [files, setFiles] = useState([]);
  const [draft, setDraft] = useState("");
  const [gateFile, setGateFile] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [filePath, setFilePath] = useState("");
  const hasNativePicker = Boolean(window.electronAPI?.pickFile);
  const [voiceActive, setVoiceActive] = useState(false);
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

  // VoiceRecorder owns the whole hold/slide-to-cancel/lock/review state
  // machine itself - see ConversationPane.jsx's identical comment on its
  // own handleSendVoiceNote. Only real difference here is the
  // destination: sendGroupVoiceMessage fans the clip out to every member
  // the same way sendGroupFile already does for any other attachment.
  function handleSendVoiceNote(blob, note) {
    if (!group) return;
    api
      .sendGroupVoiceMessage(group.group_id, blob)
      .then(() => setTimeout(refreshFiles, 400))
      .catch(() => {});
    if (note) api.sendGroupMessage(group.group_id, note).catch(() => {});
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

  // A sent file fanned out to the group collapses into one aggregate row
  // (see file.recipients) backed by one real transfer_id per member -
  // deleting it deletes this device's own history entry for every one of
  // those, same delete-for-me semantics as ConversationPane's own
  // handleDeleteFile, just fanned out the same way sending already was.
  function handleDeleteFile(file) {
    const transferIds = file.recipients ? file.recipients.map((r) => r.transfer_id) : [file.transfer_id];
    setFiles((prev) => prev.filter((f) => f.transfer_id !== file.transfer_id));
    Promise.all(transferIds.map((id) => api.deleteFile(id).catch(() => {})));
  }

  function handleDeleteMessage(msg, everyone) {
    setMessages((prev) => prev.filter((m) => m.msg_id !== msg.msg_id));
    api.deleteGroupMessage(group.group_id, msg.msg_id, { everyone }).catch(() => {});
  }

  // Everyone this device has ever talked to or can currently see, plus
  // every other group this device is in (excluding this group itself,
  // forwarding a message back into its own timeline isn't a real action).
  // Offline peers are included on purpose, same reasoning as
  // ConversationPane's own forwardCandidates: forwarding just calls the
  // same api.sendMessage()/sendFile() the plain composer already uses,
  // which already queues for an offline peer and delivers automatically.
  const peerCandidates = new Map();
  for (const c of conversations) peerCandidates.set(c.peer_id, { id: c.peer_id, name: c.name || "Unknown", kind: "peer" });
  for (const p of livePeers) peerCandidates.set(p.peer_id, { id: p.peer_id, name: p.name, kind: "peer" });
  const forwardCandidates = [...peerCandidates.values(), ...otherGroups.map((g) => ({ id: g.group_id, name: g.name, kind: "group" }))];

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

  const query = searchOpen ? searchQuery.trim().toLowerCase() : "";
  const timeline = [...messages.map((m) => ({ kind: "message", ts: m.ts, data: m })), ...collapseSentCopies(files).map((f) => ({ kind: "file", ts: f.ts, data: f }))]
    .filter((item) => !query || (item.kind === "message" ? item.data.body.toLowerCase().includes(query) : item.data.filename.toLowerCase().includes(query)))
    .sort((a, b) => a.ts - b.ts);

  let lastDay = null;

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--ground)" }}>
      <div style={{ flex: "0 0 auto", height: 62, borderBottom: "1px solid var(--divider)", background: "var(--panel)", display: "flex", alignItems: "center", gap: 13, padding: "0 20px" }}>
        {/* Design screen 10.3: overlapping member avatars instead of a
            single group-initials badge - capped at 3 shown, same idea as
            GroupCallOverlay's own participant stack. */}
        <span style={{ display: "flex", flexShrink: 0 }}>
          {group.members.slice(0, 3).map((m, i) => {
            const { bg, text } = paletteFor(m.peer_id);
            return (
              <span
                key={m.peer_id}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 99,
                  background: bg,
                  color: text,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 600,
                  border: "2px solid var(--panel)",
                  marginLeft: i === 0 ? 0 : -14,
                }}
              >
                {initials(m.name)}
              </span>
            );
          })}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{group.name}</div>
          <div style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {group.members.length} people{onlineCount != null ? ` · ${onlineCount} on this network right now` : ""}
          </div>
        </div>
        {/* Same real fix as ConversationPane.jsx's identical header button
            group - flexShrink: 1 + overflowX here instead of rigid, so a
            narrow window scrolls just this row instead of the whole page. */}
        <div style={{ display: "flex", gap: 8, flexShrink: 1, minWidth: 0, overflowX: "auto", scrollbarWidth: "none" }}>
          <button
            onClick={() => handleStartCall("audio")}
            disabled={callDisabled}
            title={callDisabled ? `Group calling is limited to ${MAX_GROUP_CALL_MEMBERS} people, this group has ${group.members.length}` : undefined}
            style={{ ...pillButtonStyle, opacity: callDisabled ? 0.5 : 1 }}
          >
            Call all
          </button>
          <button
            onClick={() => handleStartCall("video")}
            disabled={callDisabled}
            title={callDisabled ? `Group calling is limited to ${MAX_GROUP_CALL_MEMBERS} people, this group has ${group.members.length}` : undefined}
            style={{ ...pillButtonStyle, opacity: callDisabled ? 0.5 : 1 }}
          >
            Video
          </button>
          <button onClick={() => setMembersModalOpen(true)} style={pillButtonStyle}>
            Members
          </button>
          <DropdownMenu
            label="···"
            items={[
              { label: "Search in Conversation...", onClick: () => onOpenSearch?.() },
              { label: "Export Conversation...", onClick: () => onExportConversation?.() },
            ]}
          />
        </div>
      </div>

      {membersModalOpen && <GroupMembersModal group={group} livePeers={livePeers} selfPeerId={me?.peer_id} onClose={() => setMembersModalOpen(false)} />}

      {searchOpen && (
        <div style={{ flex: "0 0 auto", padding: "10px 20px", borderBottom: "1px solid var(--divider)", background: "var(--panel)", display: "flex", alignItems: "center", gap: 10 }}>
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onCloseSearch?.()}
            placeholder={`Search in ${group.name}`}
            style={{ flex: 1, minWidth: 0, height: 36, borderRadius: 11, border: "1px solid var(--border)", padding: "0 13px", fontSize: 13.5 }}
          />
          <button
            onClick={() => {
              setSearchQuery("");
              onCloseSearch?.();
            }}
            style={{ width: 34, height: 34, borderRadius: 11, background: "var(--surface)", border: "1px solid var(--border)", fontSize: 13, color: "var(--text-muted)" }}
          >
            ✕
          </button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 24px", display: "flex", flexDirection: "column", gap: 11 }}>
        {timeline.length === 0 && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)", fontSize: 14 }}>
            {query ? `No messages match "${searchQuery.trim()}".` : "No messages yet, say hello to the group."}
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
                  onDelete={() => handleDeleteFile(item.data)}
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
        {!voiceActive && (
          <>
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
              style={{ flex: 1, minWidth: 0, height: 42, borderRadius: 14, border: "1px solid var(--border)", padding: "0 15px", fontSize: 14 }}
            />
          </>
        )}
        {/* Single stable instance - see ConversationPane.jsx's identical
            comment for why conditionally mounting a second one instead of
            just moving this one is a real bug, not just untidy. */}
        <VoiceRecorder onSend={handleSendVoiceNote} onActiveChange={setVoiceActive} />
        {!voiceActive && (
          <button
            onClick={handleSend}
            disabled={!draft.trim()}
            style={{ padding: "0 18px", height: 42, borderRadius: 14, border: "none", background: draft.trim() ? "var(--accent)" : "var(--border)", color: draft.trim() ? "#fff8f2" : "var(--text-3)", fontWeight: 600, fontSize: 14 }}
          >
            Send
          </button>
        )}
      </div>

      {!hasNativePicker && filePickerOpen && (
        <div style={{ flex: "0 0 auto", padding: "10px 20px", borderTop: "1px solid var(--divider)", background: "var(--panel)", display: "flex", gap: 10 }}>
          <input
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            placeholder="Full path to a file on this machine"
            style={{ flex: 1, minWidth: 0, height: 38, borderRadius: 12, border: "1px solid var(--border)", padding: "0 13px", fontSize: 13.5, fontFamily: '"IBM Plex Mono", monospace' }}
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
// the sender-name label) - right-click anywhere on the bubble opens the
// same delete/forward context menu ConversationPane's 1:1 bubbles use.
function GroupMessageBubble({ msg, isMine, onDelete, forwardCandidates, onForward }) {
  const { menuPosition, openContextMenu, closeContextMenu } = useContextMenu();
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: "58%" }}>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-3)", paddingLeft: 2 }}>{msg.sender_name}</div>
        <div
          onContextMenu={openContextMenu}
          title="Right-click for delete/forward"
          style={{ padding: "11px 15px", borderRadius: "18px 18px 18px 5px", background: "var(--surface)", border: "1px solid var(--border-soft)", fontSize: 14.5, lineHeight: 1.45, wordBreak: "break-word" }}
        >
          {msg.body}
        </div>
      </div>
      <BubbleContextMenu position={menuPosition} onClose={closeContextMenu} candidates={forwardCandidates} onForward={onForward} onDelete={onDelete} canDeleteForEveryone={isMine} />
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

function GroupFileBubble({ file, senderName, onAccept, onDecline, onRetry, onDelete, forwardCandidates, onForward }) {
  const sent = file.direction === "sent";
  const { bg, text } = extStyle(file.filename);
  const isExecutable = EXECUTABLE_EXTS.has((file.filename.split(".").pop() || "").toLowerCase());
  const pending = !sent && file.status === "awaiting_accept";
  const inProgress = file.status === "transferring" || file.status === "accepted";
  // Same terminal-state restriction as ConversationPane's own FileBubble -
  // deleting a still-live transfer would just reappear on the next poll.
  const canDelete = Boolean(onDelete) && !inProgress && !pending;
  const recipients = file.recipients || null; // only present on a collapsed sent-aggregate
  const failedCount = recipients ? recipients.filter((r) => r.status === "failed").length : file.status === "failed" ? 1 : 0;
  const completedCount = recipients ? recipients.filter((r) => r.status === "completed").length : file.status === "completed" ? 1 : 0;
  const totalCount = recipients ? recipients.length : 1;
  const [imagePreviewFailed, setImagePreviewFailed] = useState(false);
  // Same fallback as ConversationPane's FileBubble: a real read failure (no
  // Electron, oversized file) falls back to the generic icon row instead of
  // leaving a blank gap where the thumbnail should be.
  const showImage = !sent && isImageFile(file.filename) && Boolean(file.saved_path) && !imagePreviewFailed;
  const [videoPreviewFailed, setVideoPreviewFailed] = useState(false);
  // Checked, and rendered, before showVideo below - a voice note is also a
  // .webm file (see fileTypes.js's isVoiceMessage), so isVideoFile would
  // independently match it too; this just has to win the ternary first.
  // Deliberately NOT gated on !sent the way showImage/showVideo above are -
  // a sent voice note is the one file type whose saved_path the sender
  // genuinely does keep (see filetransfer.py's keep_sender_copy), so they
  // can hear their own note played back too, same as the receiver can.
  const [audioPreviewFailed, setAudioPreviewFailed] = useState(false);
  const showAudio = isVoiceMessage(file.filename) && Boolean(file.saved_path) && !audioPreviewFailed;
  const showVideo = !sent && isVideoFile(file.filename) && Boolean(file.saved_path) && !videoPreviewFailed;
  // Same restriction as ConversationPane's own canForward: only a received,
  // completed file has a real local saved_path to re-send from.
  const canForward = !sent && file.status === "completed" && Boolean(file.saved_path);
  const { menuPosition, openContextMenu, closeContextMenu } = useContextMenu();

  return (
    <div style={{ maxWidth: "58%", alignSelf: sent ? "flex-end" : "flex-start", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-3)", paddingLeft: 2, textAlign: sent ? "right" : "left" }}>{senderName}</div>
      <div
        onContextMenu={canForward || canDelete ? openContextMenu : undefined}
        title={canForward || canDelete ? "Right-click for delete/forward" : undefined}
        style={{
          padding: "11px 13px",
          borderRadius: sent ? "18px 18px 5px 18px" : "18px 18px 18px 5px",
          background: sent && showAudio ? "var(--accent)" : "var(--surface)",
          border: isExecutable ? "1.5px solid var(--danger)" : showAudio ? "none" : "1px solid var(--border-soft)",
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
        ) : showAudio ? (
          <VoiceBubblePlayer transferId={file.transfer_id} filename={file.filename} variant={sent ? "sent" : "received"} onFail={() => setAudioPreviewFailed(true)} />
        ) : showVideo ? (
          <>
            <VideoPreview transferId={file.transfer_id} filename={file.filename} onFail={() => setVideoPreviewFailed(true)} />
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
          </div>
        )}
      </div>
      {(canForward || canDelete) && (
        <BubbleContextMenu
          position={menuPosition}
          onClose={closeContextMenu}
          candidates={canForward ? forwardCandidates : null}
          onForward={onForward}
          onDelete={canDelete ? onDelete : undefined}
          canDeleteForEveryone={false}
        />
      )}
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
  flexShrink: 0,
};
