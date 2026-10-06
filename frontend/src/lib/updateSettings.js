// Local-only update preferences, same pattern as mute.js/chatTheme.js -
// never synced anywhere, never sent to a peer. The GitHub token is the one
// exception worth calling out explicitly: it's only ever used, on this
// device, in a direct fetch() to api.github.com when the user deliberately
// deletes a release - never bundled into the app, never sent anywhere else.
const AUTO_UPDATE_KEY = "agora.autoUpdateEnabled";
const AUTO_INSTALL_KEY = "agora.autoInstallEnabled";
const INTERVAL_DAYS_KEY = "agora.updateCheckIntervalDays";
const LAST_CHECKED_KEY = "agora.updateLastCheckedAt";
const GITHUB_TOKEN_KEY = "agora.githubToken";
const REPO_KEY = "agora.updateRepo";
const SOURCE_MODE_KEY = "agora.updateSourceMode";

// The default update source - Agora's own repo, used until/unless a user
// explicitly points this at a different one via "Change". Not a forced
// destination: just what a fresh install checks before anyone has to type
// anything in, same way any other app ships pointed at its own publisher's
// releases by default.
export const DEFAULT_REPO = "abdul-wahid-lab/agora";

// Accepts a GitHub repo URL in any of the forms people actually paste -
// with/without a scheme, with/without "www.", with/without a trailing
// "/" or ".git" - and returns "owner/repo", or null if it isn't a GitHub
// repo URL at all. Not restricted to Agora's own repo: a user can point
// this at any github.com/<owner>/<repo>, their own fork included.
export function parseGithubRepoUrl(input) {
  const trimmed = (input || "").trim();
  const match = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

export function getUpdateRepo() {
  try {
    return localStorage.getItem(REPO_KEY) || DEFAULT_REPO;
  } catch {
    return DEFAULT_REPO;
  }
}

export function setUpdateRepo(ownerSlashRepo) {
  try {
    if (ownerSlashRepo) localStorage.setItem(REPO_KEY, ownerSlashRepo);
    else localStorage.removeItem(REPO_KEY);
  } catch {
    // ignore
  }
}

export function getAutoUpdateEnabled() {
  try {
    return localStorage.getItem(AUTO_UPDATE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAutoUpdateEnabled(enabled) {
  try {
    localStorage.setItem(AUTO_UPDATE_KEY, enabled ? "1" : "0");
  } catch {
    // ignore - a preference, not worth crashing over
  }
}

// A real second step past "automatically check": with this also on, a
// background check that finds a genuinely newer release downloads and
// installs it with no click required at all, rather than only opening the
// Updates dialog for a human to finish. Off by default even when auto-check
// is on - checking silently is one thing, installing and restarting the
// app without any action from the person using it is a meaningfully bigger
// thing to opt into, so it's a separate, explicit choice.
export function getAutoInstallEnabled() {
  try {
    return localStorage.getItem(AUTO_INSTALL_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAutoInstallEnabled(enabled) {
  try {
    localStorage.setItem(AUTO_INSTALL_KEY, enabled ? "1" : "0");
  } catch {
    // ignore
  }
}

export function getCheckIntervalDays() {
  try {
    const v = Number(localStorage.getItem(INTERVAL_DAYS_KEY));
    return Number.isFinite(v) && v > 0 ? v : 3;
  } catch {
    return 3;
  }
}

export function setCheckIntervalDays(days) {
  try {
    localStorage.setItem(INTERVAL_DAYS_KEY, String(days));
  } catch {
    // ignore
  }
}

export function getLastCheckedAt() {
  try {
    const v = Number(localStorage.getItem(LAST_CHECKED_KEY));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

export function setLastCheckedAt(ts) {
  try {
    localStorage.setItem(LAST_CHECKED_KEY, String(ts));
  } catch {
    // ignore
  }
}

export function isAutoCheckDue() {
  if (!getAutoUpdateEnabled()) return false;
  const elapsedMs = Date.now() - getLastCheckedAt();
  return elapsedMs >= getCheckIntervalDays() * 24 * 60 * 60 * 1000;
}

export function getGithubToken() {
  try {
    return localStorage.getItem(GITHUB_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setGithubToken(token) {
  try {
    if (token) localStorage.setItem(GITHUB_TOKEN_KEY, token);
    else localStorage.removeItem(GITHUB_TOKEN_KEY);
  } catch {
    // ignore
  }
}

// Which of the two real update sources the modal last used - "github" or
// "folder". Remembered so a user who prefers the offline folder flow isn't
// dropped back into the GitHub tab every time they open Updates.
export function getUpdateSourceMode() {
  try {
    const v = localStorage.getItem(SOURCE_MODE_KEY);
    return v === "folder" ? "folder" : "github";
  } catch {
    return "github";
  }
}

export function setUpdateSourceMode(mode) {
  try {
    localStorage.setItem(SOURCE_MODE_KEY, mode === "folder" ? "folder" : "github");
  } catch {
    // ignore
  }
}

// Plain three-part version comparison ("0.2.0" > "0.1.9"), used by the
// folder source since it has no structured API like GitHub's to lean on -
// just a version parsed out of a filename. Returns true if `a` is strictly
// newer than `b`.
export function isNewerVersion(a, b) {
  const pa = (a || "").split(".").map(Number);
  const pb = (b || "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}
