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
var __chaincloudUpdaterChildProcessV12 = require("child_process");
var __chaincloudUpdaterCryptoV12 = require("crypto");
var __chaincloudUpdaterRepoV12 = ${JSON.stringify(`${REPO_OWNER}/${REPO_NAME}`)};
var __chaincloudUpdaterCurrentTagV12 = ${JSON.stringify(releaseTag)};
var __chaincloudUpdaterStateV12 = { lifecycleState: "idle", isUpdateReady: false, release: null, asset: null, deltaAsset: null, error: null, autoStarted: false, checking: null };
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
function __chaincloudUpdaterSafeTagV12(tag) {
  return String(tag || "").replace(/[^a-zA-Z0-9._-]+/g, "-");
}
function __chaincloudUpdaterPickDeltaAssetV12(release) {
  if (process.platform !== "win32") return null;
  let assets = Array.isArray(release?.assets) ? release.assets : [];
  let fromTag = __chaincloudUpdaterSafeTagV12(__chaincloudUpdaterCurrentTagV12).toLowerCase();
  let toTag = __chaincloudUpdaterSafeTagV12(release?.tag_name).toLowerCase();
  if (!fromTag || !toTag || fromTag === toTag) return null;
  let needle = ("from-" + fromTag + "-to-" + toTag).toLowerCase();
  return assets.find(asset => {
    let name = String(asset?.name || "").toLowerCase();
    return asset?.browser_download_url && name.endsWith(".patch.zip") && name.includes("chaincloud-win-x64") && name.includes(needle);
  }) || null;
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
  let deltaAsset = __chaincloudUpdaterPickDeltaAssetV12(release);
  return { release, asset, deltaAsset };
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
      __chaincloudUpdaterStateV12.deltaAsset = hasUpdate ? latest.deltaAsset : null;
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
function __chaincloudUpdaterPsLiteralV12(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}
function __chaincloudUpdaterSafeRelativePathV12(value) {
  let normalized = String(value || "").replace(/\\\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized) || normalized.split("/").includes("..")) throw Error("Unsafe delta path: " + value);
  return normalized.split("/").join(__chaincloudUpdaterPathV12.sep);
}
async function __chaincloudUpdaterSha256FileV12(file) {
  return await new Promise((resolve, reject) => {
    let hash = __chaincloudUpdaterCryptoV12.createHash("sha256");
    let input = __chaincloudUpdaterFsV12.createReadStream(file);
    input.on("data", chunk => hash.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolve(hash.digest("hex")));
  });
}
async function __chaincloudExtractZipV12(zipPath, destDir) {
  await __chaincloudUpdaterFsV12.promises.rm(destDir, { recursive: true, force: true });
  await __chaincloudUpdaterFsV12.promises.mkdir(destDir, { recursive: true });
  await new Promise((resolve, reject) => {
    let child = __chaincloudUpdaterChildProcessV12.spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "Expand-Archive -LiteralPath " + __chaincloudUpdaterPsLiteralV12(zipPath) + " -DestinationPath " + __chaincloudUpdaterPsLiteralV12(destDir) + " -Force"], { windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", chunk => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(Error("Expand-Archive failed: " + (stderr || code))));
  });
}
async function __chaincloudPrepareWindowsDeltaSelfUpdateV12(patchPath, release) {
  let appDir = __chaincloudUpdaterPathV12.dirname(process.execPath);
  let exeName = __chaincloudUpdaterPathV12.basename(process.execPath);
  let workDir = __chaincloudUpdaterPathV12.join(__chaincloudUpdaterElectronV12.app.getPath("temp"), "chaincloud-codex-delta-update-" + Date.now());
  let extractDir = __chaincloudUpdaterPathV12.join(workDir, "delta");
  let scriptPath = __chaincloudUpdaterPathV12.join(workDir, "apply-delta-update.ps1");
  let logPath = __chaincloudUpdaterPathV12.join(workDir, "apply-delta-update.log");
  await __chaincloudExtractZipV12(patchPath, extractDir);
  let manifestPath = __chaincloudUpdaterPathV12.join(extractDir, "chaincloud-delta-manifest.json");
  let manifest = JSON.parse(await __chaincloudUpdaterFsV12.promises.readFile(manifestPath, "utf8"));
  if (manifest?.kind !== "chaincloud-windows-file-delta") throw Error("Invalid delta update manifest");
  if (manifest.fromTag !== __chaincloudUpdaterCurrentTagV12 || manifest.toTag !== release?.tag_name) throw Error("Delta update tag mismatch");
  let files = Array.isArray(manifest.files) ? manifest.files : [];
  let deletes = Array.isArray(manifest.deletes) ? manifest.deletes : [];
  for (let item of [...files, ...deletes]) item.__safePath = __chaincloudUpdaterSafeRelativePathV12(item.path);
  for (let item of files) {
    let payload = __chaincloudUpdaterPathV12.join(extractDir, "files", item.__safePath);
    if (!__chaincloudUpdaterFsV12.existsSync(payload)) throw Error("Delta payload missing: " + item.path);
    let payloadHash = await __chaincloudUpdaterSha256FileV12(payload);
    if (payloadHash !== item.sha256) throw Error("Delta payload hash mismatch: " + item.path);
    let target = __chaincloudUpdaterPathV12.join(appDir, item.__safePath);
    if (item.fromSha256) {
      if (!__chaincloudUpdaterFsV12.existsSync(target)) throw Error("Installed file missing for delta: " + item.path);
      let currentHash = await __chaincloudUpdaterSha256FileV12(target);
      if (currentHash !== item.fromSha256) throw Error("Installed file hash mismatch for delta: " + item.path);
    } else if (__chaincloudUpdaterFsV12.existsSync(target)) {
      throw Error("Delta new file already exists: " + item.path);
    }
  }
  for (let item of deletes) {
    let target = __chaincloudUpdaterPathV12.join(appDir, item.__safePath);
    if (!__chaincloudUpdaterFsV12.existsSync(target)) continue;
    let currentHash = await __chaincloudUpdaterSha256FileV12(target);
    if (currentHash !== item.fromSha256) throw Error("Installed delete file hash mismatch for delta: " + item.path);
  }
  let lines = [
    "$ErrorActionPreference = 'Stop'",
    "$appDir = " + __chaincloudUpdaterPsLiteralV12(appDir),
    "$exeName = " + __chaincloudUpdaterPsLiteralV12(exeName),
    "$deltaDir = " + __chaincloudUpdaterPsLiteralV12(extractDir),
    "$manifestPath = Join-Path $deltaDir 'chaincloud-delta-manifest.json'",
    "$filesDir = Join-Path $deltaDir 'files'",
    "$logPath = " + __chaincloudUpdaterPsLiteralV12(logPath),
    "$pidToWait = " + String(process.pid),
    "function Write-Log($message) { Add-Content -LiteralPath $logPath -Value ((Get-Date).ToString('s') + ' ' + $message) }",
    "Write-Log 'waiting for app to exit'",
    "Start-Sleep -Milliseconds 800",
    "try { Wait-Process -Id $pidToWait -Timeout 90 } catch {}",
    "$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json",
    "foreach ($item in @($manifest.deletes)) { $target = Join-Path $appDir $item.path; if (Test-Path -LiteralPath $target) { Write-Log ('deleting ' + $item.path); Remove-Item -LiteralPath $target -Force } }",
    "foreach ($item in @($manifest.files)) { $src = Join-Path $filesDir $item.path; $dest = Join-Path $appDir $item.path; $parent = Split-Path -Parent $dest; if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }; Write-Log ('copying ' + $item.path); Copy-Item -LiteralPath $src -Destination $dest -Force; $hash = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash.ToLowerInvariant(); if ($hash -ne $item.sha256) { throw ('hash mismatch after copy: ' + $item.path) } }",
    "$targetExe = Join-Path $appDir $exeName",
    "Write-Log ('restarting ' + $targetExe)",
    "Start-Process -FilePath $targetExe -WorkingDirectory $appDir",
  ];
  await __chaincloudUpdaterFsV12.promises.writeFile(scriptPath, lines.join("\\r\\n") + "\\r\\n", "utf8");
  return scriptPath;
}
async function __chaincloudPrepareWindowsSelfUpdateV12(zipPath) {
  let appDir = __chaincloudUpdaterPathV12.dirname(process.execPath);
  let exeName = __chaincloudUpdaterPathV12.basename(process.execPath);
  let workDir = __chaincloudUpdaterPathV12.join(__chaincloudUpdaterElectronV12.app.getPath("temp"), "chaincloud-codex-update-" + Date.now());
  await __chaincloudUpdaterFsV12.promises.mkdir(workDir, { recursive: true });
  let extractDir = __chaincloudUpdaterPathV12.join(workDir, "extract");
  let scriptPath = __chaincloudUpdaterPathV12.join(workDir, "apply-update.ps1");
  let logPath = __chaincloudUpdaterPathV12.join(workDir, "apply-update.log");
  let lines = [
    "$ErrorActionPreference = 'Stop'",
    "$zipPath = " + __chaincloudUpdaterPsLiteralV12(zipPath),
    "$appDir = " + __chaincloudUpdaterPsLiteralV12(appDir),
    "$exeName = " + __chaincloudUpdaterPsLiteralV12(exeName),
    "$extractDir = " + __chaincloudUpdaterPsLiteralV12(extractDir),
    "$logPath = " + __chaincloudUpdaterPsLiteralV12(logPath),
    "$pidToWait = " + String(process.pid),
    "function Write-Log($message) { Add-Content -LiteralPath $logPath -Value ((Get-Date).ToString('s') + ' ' + $message) }",
    "Write-Log 'waiting for app to exit'",
    "Start-Sleep -Milliseconds 800",
    "try { Wait-Process -Id $pidToWait -Timeout 90 } catch {}",
    "Write-Log 'extracting update archive'",
    "if (Test-Path -LiteralPath $extractDir) { Remove-Item -LiteralPath $extractDir -Recurse -Force }",
    "New-Item -ItemType Directory -Force -Path $extractDir | Out-Null",
    "Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force",
    "$exe = Get-ChildItem -LiteralPath $extractDir -Recurse -Filter $exeName | Select-Object -First 1",
    "if (-not $exe) { throw ('Cannot find ' + $exeName + ' in update archive') }",
    "$sourceDir = $exe.DirectoryName",
    "Write-Log ('copying from ' + $sourceDir + ' to ' + $appDir)",
    "robocopy $sourceDir $appDir /MIR /R:30 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null",
    "$robocopyCode = $LASTEXITCODE",
    "if ($robocopyCode -ge 8) { throw ('robocopy failed with exit code ' + $robocopyCode) }",
    "$targetExe = Join-Path $appDir $exeName",
    "Write-Log ('restarting ' + $targetExe)",
    "Start-Process -FilePath $targetExe -WorkingDirectory $appDir",
  ];
  await __chaincloudUpdaterFsV12.promises.writeFile(scriptPath, lines.join("\\r\\n") + "\\r\\n", "utf8");
  return scriptPath;
}
function __chaincloudRunWindowsSelfUpdateV12(scriptPath) {
  let child = __chaincloudUpdaterChildProcessV12.spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref?.();
  __chaincloudUpdaterElectronV12.app.quit();
}
async function __chaincloudInstallAppUpdateV12(windowManager, sender) {
  if (!__chaincloudUpdaterStateV12.asset) await __chaincloudCheckForAppUpdateV12(windowManager, sender, { silent: false });
  let asset = __chaincloudUpdaterStateV12.asset;
  let deltaAsset = __chaincloudUpdaterStateV12.deltaAsset;
  let release = __chaincloudUpdaterStateV12.release;
  if (!asset) return;
  __chaincloudUpdaterStateV12.lifecycleState = "installing";
  __chaincloudUpdaterNotifyV12(windowManager, sender);
  try {
    if (process.platform === "win32" && deltaAsset) {
      try {
        let deltaTarget = await __chaincloudDownloadAssetV12(deltaAsset, windowManager, sender);
        let deltaScriptPath = await __chaincloudPrepareWindowsDeltaSelfUpdateV12(deltaTarget, release);
        __chaincloudUpdaterStateV12.lifecycleState = "ready";
        __chaincloudUpdaterNotifyV12(windowManager, sender);
        await __chaincloudUpdaterMessageBoxV12(sender, { type: "info", buttons: ["Restart and update", "Open file", "Cancel"], defaultId: 0, cancelId: 2, title: "ChainCloud Codex delta update ready", message: "Delta update has been downloaded and verified. Restart to apply it.", detail: deltaTarget }).then(result => {
          if (result.response === 0) return __chaincloudRunWindowsSelfUpdateV12(deltaScriptPath);
          if (result.response === 1) return __chaincloudUpdaterElectronV12.shell.openPath(deltaTarget);
        });
        return;
      } catch (deltaError) {
        console.warn("[ChainCloud updater] delta update unavailable, falling back to full package", deltaError);
        __chaincloudUpdaterStateV12.deltaAsset = null;
      }
    }
    let target = await __chaincloudDownloadAssetV12(asset, windowManager, sender);
    __chaincloudUpdaterStateV12.lifecycleState = "ready";
    __chaincloudUpdaterNotifyV12(windowManager, sender);
    if (process.platform === "win32" && target.toLowerCase().endsWith(".zip")) {
      let scriptPath = await __chaincloudPrepareWindowsSelfUpdateV12(target);
      await __chaincloudUpdaterMessageBoxV12(sender, { type: "info", buttons: ["重启并更新", "打开文件", "取消"], defaultId: 0, cancelId: 2, title: "ChainCloud Codex 更新已就绪", message: "更新已下载，重启后会自动替换当前程序", detail: target }).then(result => {
        if (result.response === 0) return __chaincloudRunWindowsSelfUpdateV12(scriptPath);
        if (result.response === 1) return __chaincloudUpdaterElectronV12.shell.openPath(target);
      });
      return;
    }
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
