import { useEffect, useState } from "react";
import { ModalOverlay } from "./TitleBarModals";
import {
  getAutoUpdateEnabled,
  setAutoUpdateEnabled,
  getCheckIntervalDays,
  setCheckIntervalDays,
  setLastCheckedAt,
  getGithubToken,
  setGithubToken,
  getUpdateRepo,
  setUpdateRepo,
  parseGithubRepoUrl,
  getUpdateSourceMode,
  setUpdateSourceMode,
  isNewerVersion,
} from "../lib/updateSettings";

const CURRENT_VERSION = typeof __AGORA_VERSION__ !== "undefined" ? __AGORA_VERSION__ : "dev";

function currentVersion() {
  return CURRENT_VERSION;
}

function buttonStyle(primary) {
  return {
    padding: "8px 14px",
    borderRadius: 10,
    fontSize: 12.5,
    fontWeight: 600,
    background: primary ? "var(--accent)" : "var(--surface)",
    color: primary ? "#fff" : "var(--text-strong)",
    border: primary ? "none" : "1px solid var(--border)",
  };
}

// The real app surface for everything update-related, from either of two
// real sources: a GitHub repo (defaulting to Agora's own, changeable to
// any repo) or a local folder (a USB drive, a shared network folder -
// anything reachable with zero internet). Both end at the same install
// step; they differ only in how the candidate installer is found.
export default function UpdatesModal({ onClose }) {
  const [sourceMode, setSourceMode] = useState(getUpdateSourceMode());

  function handleModeChange(mode) {
    setSourceMode(mode);
    setUpdateSourceMode(mode);
  }

  return (
    <ModalOverlay title="Updates" onClose={onClose} width={480}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", borderRadius: 10, background: "var(--surface-2)", padding: 3, gap: 3 }}>
          {[
            { id: "github", label: "GitHub" },
            { id: "folder", label: "Local Folder" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => handleModeChange(t.id)}
              style={{
                flex: 1,
                padding: "7px 0",
                borderRadius: 7,
                fontSize: 12.5,
                fontWeight: 600,
                background: sourceMode === t.id ? "var(--surface)" : "transparent",
                color: sourceMode === t.id ? "var(--text-strong)" : "var(--text-muted)",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {sourceMode === "github" ? <GithubSource /> : <FolderSource />}
      </div>
    </ModalOverlay>
  );
}

// -- GitHub source ------------------------------------------------------
// Defaults to Agora's own repo so a fresh install has something real to
// check immediately, with no URL to type in just to get the default - but
// nothing stops a user from pointing "Change" at any other repo, their own
// fork included.
function GithubSource() {
  const electron = typeof window !== "undefined" ? window.electronAPI : null;
  const [repo, setRepo] = useState(getUpdateRepo());
  const [editingRepo, setEditingRepo] = useState(false);
  const [repoInput, setRepoInput] = useState(`https://github.com/${repo}`);
  const [repoError, setRepoError] = useState("");
  const [validating, setValidating] = useState(false);
  const [phase, setPhase] = useState("checking"); // checking | upToDate | available | downloading | ready | error
  const [latest, setLatest] = useState(null);
  const [errorText, setErrorText] = useState("");
  const [progress, setProgress] = useState("");
  const [downloadedPath, setDownloadedPath] = useState(null);
  const [autoEnabled, setAutoEnabled] = useState(getAutoUpdateEnabled());
  const [intervalDays, setIntervalDays] = useState(getCheckIntervalDays());
  const [manageOpen, setManageOpen] = useState(false);

  useEffect(() => {
    checkNow(repo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The URL field's own submit: parses what was typed, and - since a
  // malformed URL is the one case that should never touch the network at
  // all - rejects it immediately rather than letting a fetch() to a
  // nonsense address stand in for validation. Only a URL that actually
  // parses as a github.com/<owner>/<repo> address, AND that repo actually
  // existing, is accepted and remembered for next time.
  async function handleSubmitRepo() {
    setRepoError("");
    const parsed = parseGithubRepoUrl(repoInput);
    if (!parsed) {
      setRepoError("That URL is wrong - it needs to be a github.com repository link, like https://github.com/owner/repo.");
      return;
    }
    setValidating(true);
    try {
      const res = await fetch(`https://api.github.com/repos/${parsed}`);
      if (res.status === 404) {
        setRepoError("That repository doesn't exist, or is private.");
        setValidating(false);
        return;
      }
      if (!res.ok) {
        setRepoError("Couldn't reach GitHub to verify that repository right now.");
        setValidating(false);
        return;
      }
    } catch {
      setRepoError("Couldn't reach GitHub right now - check your connection.");
      setValidating(false);
      return;
    }
    setValidating(false);
    setUpdateRepo(parsed);
    setRepo(parsed);
    setEditingRepo(false);
    checkNow(parsed);
  }

  function handleStartEditingRepo() {
    setRepoInput(`https://github.com/${repo}`);
    setRepoError("");
    setEditingRepo(true);
  }

  async function checkNow(targetRepo) {
    setPhase("checking");
    setErrorText("");
    try {
      const res = await fetch(`https://api.github.com/repos/${targetRepo}/releases/latest`);
      // A 404 here almost always means this repo has no GitHub Releases
      // published at all yet (GitHub returns 404 for /releases/latest in
      // that case, same as for a genuinely missing repo) - a real,
      // distinct situation from "no internet" that deserves its own
      // message instead of being lumped into a generic connectivity error.
      if (res.status === 404) {
        setErrorText("No releases have been published on that repository yet.");
        setPhase("error");
        return;
      }
      if (!res.ok) throw new Error("not found");
      const data = await res.json();
      setLastCheckedAt(Date.now());
      const tag = (data.tag_name || "").replace(/^v/, "");
      if (tag && tag !== currentVersion()) {
        const asset =
          data.assets?.find((a) => /setup/i.test(a.name) && a.name.endsWith(".exe")) || data.assets?.find((a) => a.name.endsWith(".exe"));
        setLatest({ version: tag, notes: data.body || "", asset, releaseUrl: data.html_url });
        setPhase("available");
      } else {
        setPhase("upToDate");
      }
    } catch {
      setErrorText("Couldn't reach GitHub right now (no internet, or it's unreachable). Agora works fully offline either way - this is the one feature that genuinely needs a connection.");
      setPhase("error");
    }
  }

  async function handleInstall() {
    if (!latest?.asset) return;
    if (!electron?.downloadUpdate) {
      // Plain-browser dev context has no filesystem/process access to
      // actually install anything - fall back to just opening the page,
      // same as this feature's very first version did for everyone.
      window.open(latest.releaseUrl, "_blank");
      return;
    }
    setPhase("downloading");
    setProgress(`Downloading ${latest.asset.name}…`);
    try {
      const path = await electron.downloadUpdate(latest.asset.browser_download_url, latest.asset.name);
      setDownloadedPath(path);
      setPhase("ready");
    } catch {
      setErrorText("The download failed. Check your connection and try again.");
      setPhase("error");
    }
  }

  async function handleRunInstaller() {
    if (!downloadedPath || !electron?.installUpdate) return;
    await electron.installUpdate(downloadedPath);
    // The main process quits this app right after launching the installer -
    // nothing meaningful to do here, the window is about to close.
  }

  function handleToggleAuto(checked) {
    setAutoEnabled(checked);
    setAutoUpdateEnabled(checked);
  }

  function handleIntervalChange(days) {
    setIntervalDays(days);
    setCheckIntervalDays(days);
  }

  if (editingRepo) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
          Enter the GitHub repository to check for updates from. Nothing is looked up until you submit a real repository URL here.
        </div>
        <input
          value={repoInput}
          onChange={(e) => setRepoInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmitRepo()}
          placeholder="https://github.com/owner/repo"
          style={{ padding: "9px 11px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", fontSize: 13 }}
        />
        {repoError && <div style={{ fontSize: 12.5, color: "#c0392b" }}>{repoError}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleSubmitRepo} disabled={validating || !repoInput.trim()} style={{ ...buttonStyle(true), opacity: validating || !repoInput.trim() ? 0.6 : 1 }}>
            {validating ? "Checking the URL…" : "Use This Repository"}
          </button>
          <button onClick={() => setEditingRepo(false)} style={buttonStyle(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11.5, color: "var(--text-muted)" }}>
        <span>github.com/{repo}</span>
        <button onClick={handleStartEditingRepo} style={{ color: "var(--accent)", fontWeight: 600 }}>
          Change
        </button>
      </div>

      <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
        {phase === "checking" && "Checking for updates…"}
        {phase === "upToDate" && `You're on the latest version (${currentVersion()}).`}
        {phase === "error" && errorText}
        {phase === "downloading" && progress}
        {(phase === "available" || phase === "ready") && latest && (
          <>
            A newer version ({latest.version}) is available. You're on {currentVersion()}.
            {!latest.asset && " Couldn't find a Windows installer in that release - visit the releases page instead."}
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(phase === "upToDate" || phase === "error") && (
          <button onClick={() => checkNow(repo)} style={buttonStyle(false)}>
            Check again
          </button>
        )}
        {phase === "available" && latest?.asset && (
          <button onClick={handleInstall} style={buttonStyle(true)}>
            {electron?.downloadUpdate ? "Download && Install" : "Open Releases Page"}
          </button>
        )}
        {phase === "ready" && (
          <button onClick={handleRunInstaller} style={buttonStyle(true)}>
            Install Now (Agora will restart)
          </button>
        )}
        {latest?.releaseUrl && phase !== "checking" && (
          <button
            onClick={() => (electron?.openExternal ? electron.openExternal(latest.releaseUrl) : window.open(latest.releaseUrl, "_blank"))}
            style={buttonStyle(false)}
          >
            View Release Notes
          </button>
        )}
      </div>

      {!electron?.downloadUpdate && phase === "available" && (
        <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Installing an update only works in the desktop app, not this plain-browser dev view.</div>
      )}

      <div style={{ height: 1, background: "var(--divider)" }} />

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-strong)" }}>Automatic checks</div>
        <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13 }}>
          <input type="checkbox" checked={autoEnabled} onChange={(e) => handleToggleAuto(e.target.checked)} />
          Automatically check for updates while Agora is running
        </label>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Off by default - Agora never reaches the internet on its own otherwise, for anything. Turning this on means it will
          periodically contact the repository above to check your version, on its own, while the app is open. It never
          downloads or installs anything without you confirming.
        </div>
        {autoEnabled && (
          <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13 }}>
            Check every
            <select value={intervalDays} onChange={(e) => handleIntervalChange(Number(e.target.value))} style={{ padding: "4px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)" }}>
              <option value={1}>day</option>
              <option value={3}>3 days</option>
              <option value={7}>week</option>
              <option value={30}>month</option>
            </select>
          </label>
        )}
      </div>

      <div style={{ height: 1, background: "var(--divider)" }} />

      <button onClick={() => setManageOpen((v) => !v)} style={{ ...buttonStyle(false), alignSelf: "flex-start" }}>
        {manageOpen ? "Hide Release Management" : "Manage Old Releases..."}
      </button>
      {manageOpen && <ManageReleases repo={repo} />}
    </div>
  );
}

// -- Local folder source --------------------------------------------------
// The one source that works with zero internet: a folder (a USB drive, a
// shared network path, anything) that already has an installer sitting in
// it. No manifest needed - the version is read straight out of the
// filename, same convention electron-builder's own NSIS output already
// uses ("Agora Setup 0.1.0.exe"). Real tradeoff, stated rather than
// glossed over: the GitHub path gets its integrity from HTTPS plus a host
// allowlist; a local file has neither - the only trust here is that the
// user picked this folder and file themselves.
function FolderSource() {
  const electron = typeof window !== "undefined" ? window.electronAPI : null;
  const [folderPath, setFolderPath] = useState(null);
  const [scan, setScan] = useState(null); // { found, version, fileName, filePath } | null
  const [status, setStatus] = useState("");
  const [installing, setInstalling] = useState(false);

  async function handleBrowse() {
    if (!electron?.pickUpdateFolder) {
      setStatus("Picking a folder only works in the desktop app, not this plain-browser dev view.");
      return;
    }
    const path = await electron.pickUpdateFolder();
    if (!path) return;
    setFolderPath(path);
    setStatus("Scanning…");
    setScan(null);
    const result = await electron.scanUpdateFolder(path);
    setScan(result);
    setStatus("");
  }

  async function handleInstall() {
    if (!scan?.filePath || !electron?.installUpdate) return;
    setInstalling(true);
    await electron.installUpdate(scan.filePath);
    // The main process quits this app right after launching the installer.
  }

  const newer = scan?.found && isNewerVersion(scan.version, currentVersion());

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
        Point this at a folder with an Agora installer already in it - a USB drive, a shared network folder, anything. No
        internet needed: the installer is read straight from the folder you pick.
      </div>

      <button onClick={handleBrowse} style={{ ...buttonStyle(false), alignSelf: "flex-start" }}>
        Browse...
      </button>

      {folderPath && <div style={{ fontSize: 11.5, color: "var(--text-muted)", wordBreak: "break-all" }}>{folderPath}</div>}

      {status && <div style={{ fontSize: 13, color: "var(--text-2)" }}>{status}</div>}

      {scan && !scan.found && <div style={{ fontSize: 13, color: "var(--text-2)" }}>No Agora installer found in that folder.</div>}

      {scan?.found && !newer && (
        <div style={{ fontSize: 13, color: "var(--text-2)" }}>
          That folder has version {scan.version} ({scan.fileName}) - you're already on {currentVersion()} or newer.
        </div>
      )}

      {scan?.found && newer && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
            Version {scan.version} found ({scan.fileName}). You're on {currentVersion()}.
          </div>
          <button onClick={handleInstall} disabled={installing} style={{ ...buttonStyle(true), alignSelf: "flex-start", opacity: installing ? 0.6 : 1 }}>
            {installing ? "Launching installer…" : "Install Now (Agora will restart)"}
          </button>
        </div>
      )}

      <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
        Unlike the GitHub source, there's no signature or transport security here beyond what the drive/folder itself already
        has - this only makes sense with a folder and file you already trust, the same way you'd trust any program you chose
        to run directly.
      </div>
    </div>
  );
}

// Deleting a GitHub release is a repo-owner action, not something a normal
// user of this app can do - GitHub itself refuses the request without a
// token that actually has write access to this repo. The token lives only
// in this device's localStorage and is only ever sent directly to
// api.github.com, in a request this device makes itself - never bundled
// into the app, never sent anywhere else.
function ManageReleases({ repo }) {
  const [token, setToken] = useState(getGithubToken());
  const [releases, setReleases] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadReleases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  async function loadReleases() {
    setLoading(true);
    setStatus("");
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases`);
      if (!res.ok) throw new Error();
      setReleases(await res.json());
    } catch {
      setStatus("Couldn't load the release list.");
      setReleases([]);
    }
    setLoading(false);
  }

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleTokenChange(value) {
    setToken(value);
    setGithubToken(value);
  }

  async function handleDeleteSelected() {
    if (!token) {
      setStatus("Enter a GitHub token with write access to this repo first.");
      return;
    }
    if (selected.size === 0) return;
    if (!window.confirm(`Permanently delete ${selected.size} release${selected.size > 1 ? "s" : ""} from GitHub? This can't be undone.`)) return;
    setStatus("Deleting…");
    let failed = 0;
    for (const id of selected) {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases/${id}`, {
        method: "DELETE",
        headers: { Authorization: `token ${token}` },
      }).catch(() => null);
      if (!res || !res.ok) failed++;
    }
    setSelected(new Set());
    await loadReleases();
    setStatus(failed > 0 ? `${failed} release(s) couldn't be deleted - check the token has write access to this repo.` : "Deleted.");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: 12, background: "var(--surface-2)" }}>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
        Deleting a release requires a GitHub personal access token with write access to this repo - this only works for the repo's
        own maintainer, not a general user. The token is stored only on this device.
      </div>
      <input
        type="password"
        placeholder="GitHub personal access token"
        value={token}
        onChange={(e) => handleTokenChange(e.target.value)}
        style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", fontSize: 12.5 }}
      />

      {loading && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading releases…</div>}

      {releases?.length === 0 && !loading && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No releases found.</div>}

      {releases?.map((r) => (
        <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5 }}>
          <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
          <span style={{ fontWeight: 600 }}>{r.tag_name}</span>
          <span style={{ color: "var(--text-muted)" }}>{r.name || ""}</span>
        </label>
      ))}

      {releases?.length > 0 && (
        <button onClick={handleDeleteSelected} disabled={selected.size === 0} style={{ ...buttonStyle(false), color: "#c0392b", borderColor: "#c0392b", opacity: selected.size === 0 ? 0.5 : 1, alignSelf: "flex-start" }}>
          Delete Selected ({selected.size})
        </button>
      )}

      {status && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{status}</div>}
    </div>
  );
}
