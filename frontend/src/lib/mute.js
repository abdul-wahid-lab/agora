// Per-peer notification muting. Local-only, like the avatar-color/photo
// choices - never synced anywhere, never told to the peer being muted.
//
// Honest scope: right now the only real OS notification this app ever
// fires is for an incoming *call* (see useCall.js) - there's no message
// notification system yet, for either 1:1 or group chat. So muting a peer
// here only ever silences their call notifications until that changes, not
// "everything from them" the way the label might otherwise imply.
const MUTED_KEY = "agora.mutedPeers";

function readMutedList() {
  try {
    return JSON.parse(localStorage.getItem(MUTED_KEY) || "[]");
  } catch {
    return [];
  }
}

export function isPeerMuted(peerId) {
  return readMutedList().includes(peerId);
}

export function setPeerMuted(peerId, muted) {
  try {
    const list = readMutedList();
    const next = muted ? [...new Set([...list, peerId])] : list.filter((id) => id !== peerId);
    localStorage.setItem(MUTED_KEY, JSON.stringify(next));
  } catch {
    // localStorage can throw in some private-browsing/quota-exceeded cases -
    // muting is a convenience, not something worth crashing over.
  }
}
