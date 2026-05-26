#!/usr/bin/env node
/**
 * Add a ChainCloud release updater on top of the upstream Electron update UI.
 *
 * The upstream Sparkle/Squirrel updater is disabled for rebuilt packages because
 * our GitHub releases publish portable zip/dmg/deb/rpm assets, not native update
 * feeds. This patch keeps the existing renderer update buttons and lifecycle
 * events, but backs them with the ChainCloud GitHub Release API.
 */
const { execFileSync } = require("child_process");
const { appRootFor, fs, path, read, relPath, write } = require("./patch-util");

const REPO_OWNER = "jhupo";
const REPO_NAME = "chaincloud-codex-rebuild";
const VERSION_MARKER = "var __CHAINCLOUD_UPDATER_V12__ = true;";
const END_MARKER = "// __CHAINCLOUD_UPDATER_V12_END__";
const MAIN_MARKER = "var w=/^[a-z0-9-_]+$/i;";
const AUTH_MARKER = "var __CHAINCLOUD_AUTH_PROXY_V11__ = true;";

function platformsFor(argPlatform) {
  const all = ["mac-arm64", "mac-x64", "win", "preview-win"];
  const requested = argPlatform === "win" ? ["win", "preview-win"] : argPlatform ? [argPlatform] : all;
  return requested.filter((p) => fs.existsSync(path.join(appRootFor(p), ".vite", "build")));
}

function currentReleaseTag() {
  if (process.env.CHAINCLOUD_RELEASE_TAG) return process.env.CHAINCLOUD_RELEASE_TAG;
  if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  if (process.env.GITHUB_REF?.startsWith("refs/tags/")) return process.env.GITHUB_REF.slice("refs/tags/".length);
  try {
    const pkg = JSON.parse(read(path.join(__dirname, "..", "package.json")));
    if (pkg.chaincloudReleaseTag) return pkg.chaincloudReleaseTag;
  } catch {}
  for (const args of [
    ["describe", "--tags", "--exact-match", "HEAD"],
    ["describe", "--tags", "--abbrev=0"],
  ]) {
    try {
      const tag = execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (tag) return tag;
    } catch {}
  }
  try {
    const pkg = JSON.parse(read(path.join(__dirname, "..", "package.json")));
    if (pkg.version) return `v${pkg.version}-chaincloud.0`;
  } catch {}
  return "";
}

function patchPackageJson(platform, releaseTag, isCheck) {
  const pkgPath = path.join(appRootFor(platform), "package.json");
  if (!fs.existsSync(pkgPath)) return false;
  const pkg = JSON.parse(read(pkgPath));
  if (pkg.chaincloudReleaseTag === releaseTag) return false;
  pkg.chaincloudReleaseTag = releaseTag;
  if (!isCheck) write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  return true;
}

function updaterInjection(releaseTag) {
  return `
${VERSION_MARKER}
var __chaincloudUpdaterElectronV12 = require("electron");
var __chaincloudUpdaterFsV12 = require("fs");
var __chaincloudUpdaterPathV12 = require("path");
var __chaincloudUpdaterStreamV12 = require("stream");
var __chaincloudUpdaterRepoV12 = ${JSON.stringify(`${REPO_OWNER}/${REPO_NAME}`)};
var __chaincloudUpdaterCurrentTagV12 = ${JSON.stringify(releaseTag)};
var __chaincloudUpdaterStateV12 = { lifecycleState: "idle", isUpdateReady: false, release: null, asset: null, error: null, autoStarted: false, checking: null };
function __chaincloudUpdaterReleaseRankV12(tag) {
  let match = String(tag || "").match(/^v?(\\d+)\\.(\\d+)\\.(\\d+)(?:-chaincloud\\.(\\d+))?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] || 0)];
}
function __chaincloudUpdaterCompareTagsV12(a, b) {
  let ar = __chaincloudUpdaterReleaseRankV12(a), br = __chaincloudUpdaterReleaseRankV12(b);
  if (!ar || !br) return String(a || "") === String(b || "") ? 0 : 1;
  for (let i = 0; i < Math.max(ar.length, br.length); i++) {
    let diff = (ar[i] || 0) - (br[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
function __chaincloudUpdaterNotifyV12(windowManager, sender) {
  let ready = { type: "app-update-ready-changed", isUpdateReady: __chaincloudUpdaterStateV12.isUpdateReady };
  let lifecycle = { type: "app-update-lifecycle-state-changed", lifecycleState: __chaincloudUpdaterStateV12.lifecycleState };
  try { windowManager?.sendMessageToAllWindows?.(ready); windowManager?.sendMessageToAllWindows?.(lifecycle); return; } catch {}
  try { sender?.send?.(F, ready); sender?.send?.(F, lifecycle); } catch {}
}
function __chaincloudUpdaterProgressV12(windowManager, sender, percent) {
  let message = { type: "app-update-install-progress-changed", installProgressPercent: Math.max(0, Math.min(100, Math.round(percent || 0))) };
  try { windowManager?.sendMessageToAllWindows?.(message); return; } catch {}
  try { sender?.send?.(F, message); } catch {}
}
function __chaincloudUpdaterMessageBoxV12(sender, options) {
  let parent = __chaincloudUpdaterElectronV12.BrowserWindow.fromWebContents(sender);
  return parent ? __chaincloudUpdaterElectronV12.dialog.showMessageBox(parent, options) : __chaincloudUpdaterElectronV12.dialog.showMessageBox(options);
}
function __chaincloudUpdaterPickAssetV12(release) {
  let assets = Array.isArray(release?.assets) ? release.assets : [];
  let platform = process.platform, arch = process.arch;
  let scored = assets.map(asset => {
    let name = String(asset?.name || "");
    let lower = name.toLowerCase();
    let score = 0;
    if (!asset?.browser_download_url) return null;
    if (platform === "win32") {
      if (!lower.endsWith(".zip") && !lower.endsWith(".exe")) return null;
      if (/(win|windows)/.test(lower)) score += 8;
      if (/x64|amd64/.test(lower)) score += 3;
      if (lower.endsWith(".zip")) score += 2;
    } else if (platform === "darwin") {
      if (!lower.endsWith(".dmg")) return null;
      if (/mac|darwin|macos/.test(lower)) score += 8;
      if (arch === "arm64" && /arm64|aarch64/.test(lower)) score += 4;
      if (arch !== "arm64" && /x64|x86_64|amd64/.test(lower)) score += 4;
    } else {
      if (!/\\.(deb|rpm|zip|appimage)$/i.test(lower)) return null;
      if (/linux/.test(lower)) score += 8;
      if (arch === "arm64" && /arm64|aarch64/.test(lower)) score += 4;
      if (arch !== "arm64" && /x64|x86_64|amd64/.test(lower)) score += 4;
      if (lower.endsWith(".deb")) score += 2;
    }
    return { asset, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  return scored[0]?.asset || null;
}
async function __chaincloudUpdaterFetchLatestV12() {
  let url = "https://api.github.com/repos/" + __chaincloudUpdaterRepoV12 + "/releases?per_page=20";
  let response = await __chaincloudUpdaterElectronV12.net.fetch(url, { headers: { accept: "application/vnd.github+json", "user-agent": "ChainCloud-Codex-Updater" } });
  if (!response.ok) throw Error("GitHub update check failed: HTTP " + response.status);
  let releases = JSON.parse(await response.text());
  let release = releases.find(item => item && !item.draft && !item.prerelease && /^v?\\d+\\.\\d+\\.\\d+-chaincloud\\.\\d+$/.test(String(item.tag_name || "")));
  if (!release) throw Error("No ChainCloud release found");
  let asset = __chaincloudUpdaterPickAssetV12(release);
  if (!asset) throw Error("No update asset for " + process.platform + "-" + process.arch);
  return { release, asset };
}
async function __chaincloudCheckForAppUpdateV12(windowManager, sender, options) {
  let silent = !!options?.silent;
  if (__chaincloudUpdaterStateV12.checking) return __chaincloudUpdaterStateV12.checking;
  __chaincloudUpdaterStateV12.lifecycleState = silent ? __chaincloudUpdaterStateV12.lifecycleState : "checking";
  __chaincloudUpdaterStateV12.error = null;
  if (!silent) __chaincloudUpdaterNotifyV12(windowManager, sender);
  __chaincloudUpdaterStateV12.checking = (async () => {
    try {
      let latest = await __chaincloudUpdaterFetchLatestV12();
      let hasUpdate = __chaincloudUpdaterCompareTagsV12(latest.release.tag_name, __chaincloudUpdaterCurrentTagV12) > 0;
      __chaincloudUpdaterStateV12.release = hasUpdate ? latest.release : null;
      __chaincloudUpdaterStateV12.asset = hasUpdate ? latest.asset : null;
      __chaincloudUpdaterStateV12.isUpdateReady = hasUpdate;
      __chaincloudUpdaterStateV12.lifecycleState = hasUpdate ? "ready" : "idle";
      __chaincloudUpdaterNotifyV12(windowManager, sender);
      if (!silent && !hasUpdate) await __chaincloudUpdaterMessageBoxV12(sender, { type: "info", buttons: ["OK"], title: "ChainCloud Codex", message: "已是最新版本", detail: __chaincloudUpdaterCurrentTagV12 || "当前构建未记录发布标签" });
      return __chaincloudUpdaterStateV12;
    } catch (error) {
      __chaincloudUpdaterStateV12.error = error?.message || String(error);
      __chaincloudUpdaterStateV12.isUpdateReady = false;
      __chaincloudUpdaterStateV12.lifecycleState = "idle";
      __chaincloudUpdaterNotifyV12(windowManager, sender);
      if (!silent) await __chaincloudUpdaterElectronV12.dialog.showErrorBox("检查更新失败", __chaincloudUpdaterStateV12.error);
      return __chaincloudUpdaterStateV12;
    } finally {
      __chaincloudUpdaterStateV12.checking = null;
    }
  })();
  return __chaincloudUpdaterStateV12.checking;
}
function __chaincloudMaybeAutoCheckAppUpdateV12(windowManager, sender, options) {
  if (__chaincloudUpdaterStateV12.autoStarted) {
    __chaincloudUpdaterNotifyV12(windowManager, sender);
    return;
  }
  __chaincloudUpdaterStateV12.autoStarted = true;
  setTimeout(() => { __chaincloudCheckForAppUpdateV12(windowManager, sender, { silent: true }).catch(() => {}); }, 5000).unref?.();
}
async function __chaincloudDownloadAssetV12(asset, windowManager, sender) {
  let safeName = String(asset.name || "ChainCloud-Codex-update").replace(/[\\\\/:*?"<>|]+/g, "-");
  let dir = __chaincloudUpdaterPathV12.join(__chaincloudUpdaterElectronV12.app.getPath("downloads"), "ChainCloud Codex Updates");
  await __chaincloudUpdaterFsV12.promises.mkdir(dir, { recursive: true });
  let target = __chaincloudUpdaterPathV12.join(dir, safeName);
  let response = await __chaincloudUpdaterElectronV12.net.fetch(asset.browser_download_url);
  if (!response.ok) throw Error("Download failed: HTTP " + response.status);
  let total = Number(response.headers.get("content-length") || asset.size || 0);
  let received = 0;
  let input = __chaincloudUpdaterStreamV12.Readable.fromWeb(response.body);
  let output = __chaincloudUpdaterFsV12.createWriteStream(target);
  input.on("data", chunk => {
    received += chunk.length;
    if (total > 0) __chaincloudUpdaterProgressV12(windowManager, sender, received / total * 100);
  });
  await new Promise((resolve, reject) => {
    input.on("error", reject);
    output.on("error", reject);
    output.on("finish", resolve);
    input.pipe(output);
  });
  __chaincloudUpdaterProgressV12(windowManager, sender, 100);
  return target;
}
async function __chaincloudInstallAppUpdateV12(windowManager, sender) {
  if (!__chaincloudUpdaterStateV12.asset) await __chaincloudCheckForAppUpdateV12(windowManager, sender, { silent: false });
  let asset = __chaincloudUpdaterStateV12.asset;
  let release = __chaincloudUpdaterStateV12.release;
  if (!asset) return;
  __chaincloudUpdaterStateV12.lifecycleState = "installing";
  __chaincloudUpdaterNotifyV12(windowManager, sender);
  try {
    let target = await __chaincloudDownloadAssetV12(asset, windowManager, sender);
    __chaincloudUpdaterStateV12.lifecycleState = "ready";
    __chaincloudUpdaterNotifyV12(windowManager, sender);
    await __chaincloudUpdaterMessageBoxV12(sender, { type: "info", buttons: ["打开文件", "打开发布页"], defaultId: 0, cancelId: 0, title: "ChainCloud Codex 更新已下载", message: "更新已下载", detail: target }).then(result => {
      if (result.response === 1) return __chaincloudUpdaterElectronV12.shell.openExternal(release?.html_url || asset.browser_download_url);
      return __chaincloudUpdaterElectronV12.shell.openPath(target);
    });
  } catch (error) {
    __chaincloudUpdaterStateV12.lifecycleState = "ready";
    __chaincloudUpdaterNotifyV12(windowManager, sender);
    await __chaincloudUpdaterElectronV12.dialog.showErrorBox("下载更新失败", error?.message || String(error));
    try { await __chaincloudUpdaterElectronV12.shell.openExternal(release?.html_url || asset.browser_download_url); } catch {}
  }
}
${END_MARKER}
`;
}

function stripExistingInjection(source) {
  const start = source.indexOf(VERSION_MARKER);
  if (start < 0) return source;
  const end = source.indexOf(END_MARKER, start);
  if (end < 0) throw new Error("Found updater injection start without end marker");
  return source.slice(0, start) + source.slice(end + END_MARKER.length).replace(/^\n/, "");
}

function existingInjection(source) {
  const start = source.indexOf(VERSION_MARKER);
  if (start < 0) return null;
  const end = source.indexOf(END_MARKER, start);
  if (end < 0) throw new Error("Found updater injection start without end marker");
  return source.slice(start, end + END_MARKER.length);
}

function patchMainBundle(platform, releaseTag, isCheck) {
  const mainDir = path.join(appRootFor(platform), ".vite", "build");
  const candidates = fs
    .readdirSync(mainDir)
    .filter((file) => /^main-.*\.js$/.test(file))
    .sort()
    .map((file) => path.join(mainDir, file));
  if (candidates.length === 0) return { file: null, changed: false };
  const file = candidates[0];
  let source = read(file);
  const original = source;
  const desiredInjection = updaterInjection(releaseTag).trim();

  if (existingInjection(source)?.trim() !== desiredInjection) {
    source = stripExistingInjection(source);
    const markerIndex = source.indexOf(MAIN_MARKER);
    if (markerIndex < 0) throw new Error("Unable to locate main bundle insertion point");
    const authIndex = source.indexOf(AUTH_MARKER);
    const insertIndex = authIndex >= 0 && authIndex < markerIndex ? authIndex : markerIndex;
    source = source.slice(0, insertIndex) + updaterInjection(releaseTag) + source.slice(insertIndex);
  }

  if (!source.includes("case`check-app-update`:await __chaincloudCheckForAppUpdateV12")) {
    const before = "case`check-app-update`:this.sparkleManager.checkForUpdates();break;case`install-app-update`:";
    const after = "case`check-app-update`:await __chaincloudCheckForAppUpdateV12(this.windowManager,r,{silent:!1});break;case`install-app-update`:";
    if (!source.includes(before)) throw new Error("Unable to locate check-app-update handler");
    source = source.replace(before, after);
  }

  if (!source.includes("await __chaincloudInstallAppUpdateV12(this.windowManager,r);break;case`debug-run-app-action-request`")) {
    const before = "this.sparkleManager.installUpdatesIfAvailable();break;case`debug-run-app-action-request`";
    const after = "await __chaincloudInstallAppUpdateV12(this.windowManager,r);break;case`debug-run-app-action-request`";
    if (!source.includes(before)) throw new Error("Unable to locate install-app-update handler");
    source = source.replace(before, after);
  }

  if (!source.includes("__chaincloudMaybeAutoCheckAppUpdateV12(this.windowManager,r,{silent:!0})")) {
    const before = "process.platform===`win32`&&r.send(F,{type:`app-update-install-progress-changed`,installProgressPercent:this.sparkleManager.getInstallProgressPercent()}),this.samplerManager.handleRendererReady(r)";
    const after = "process.platform===`win32`&&r.send(F,{type:`app-update-install-progress-changed`,installProgressPercent:this.sparkleManager.getInstallProgressPercent()}),__chaincloudMaybeAutoCheckAppUpdateV12(this.windowManager,r,{silent:!0}),this.samplerManager.handleRendererReady(r)";
    if (!source.includes(before)) throw new Error("Unable to locate renderer-ready update state sender");
    source = source.replace(before, after);
  }

  const changed = source !== original;
  if (!isCheck && changed) write(file, source);
  return { file, changed };
}

function main() {
  const args = process.argv.slice(2);
  const platformArg = args.find((a) => ["mac-arm64", "mac-x64", "win"].includes(a));
  const isCheck = args.includes("--check");
  const releaseTag = currentReleaseTag();
  if (!releaseTag) throw new Error("Unable to determine current ChainCloud release tag");

  for (const platform of platformsFor(platformArg)) {
    const pkgChanged = patchPackageJson(platform, releaseTag, isCheck);
    const result = patchMainBundle(platform, releaseTag, isCheck);
    if (!result.file) {
      console.log(`  [${platform}] no main bundle`);
      continue;
    }
    console.log(`  [${platform}] ${relPath(result.file)}${result.changed || pkgChanged ? " patched" : " unchanged"} (${releaseTag})`);
  }
}

main();
