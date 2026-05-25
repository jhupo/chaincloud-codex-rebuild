const { appRootFor, fs, path, read, write } = require("../patch-util");
const {
  CHAINCLOUD_CONFIG_IPC_CHANNEL,
  CHAINCLOUD_IPC_CHANNEL,
  CHAINCLOUD_LOGIN_IPC_CHANNEL,
  CHAINCLOUD_LOGOUT_IPC_CHANNEL,
  CHAINCLOUD_ORIGIN,
  CLIENT_FILE,
  QR_IMAGE_ORIGIN,
  TURNSTILE_ORIGIN,
} = require("./constants");
const { jsClientSource } = require("./client-source");
function patchHtml(platform, isCheck) {
  const root = appRootFor(platform);
  const htmlPath = path.join(root, "webview", "index.html");
  if (!fs.existsSync(htmlPath)) return false;
  let html = read(htmlPath);
  let changed = false;

  if (!html.includes(`assets/${CLIENT_FILE}`)) {
    html = html.replace(
      /(<script type="module" crossorigin src="\.\/assets\/[^"]+"><\/script>)/,
      `<script src="./assets/${CLIENT_FILE}"></script>\n    $1`,
    );
    changed = true;
  }

  function ensureCspSource(directive, source) {
    const needle = `${directive} `;
    const start = html.indexOf(needle);
    if (start < 0) return;
    const end = html.indexOf("; ", start);
    const segmentEnd = end >= 0 ? end : html.indexOf('"', start);
    if (segmentEnd < 0) return;
    const segment = html.slice(start, segmentEnd);
    if (segment.split(/\s+/).includes(source)) return;
    html = html.slice(0, start + needle.length) + `${source} ` + html.slice(start + needle.length);
    changed = true;
  }

  ensureCspSource("connect-src", CHAINCLOUD_ORIGIN);
  ensureCspSource("connect-src", TURNSTILE_ORIGIN);
  ensureCspSource("script-src", TURNSTILE_ORIGIN);
  ensureCspSource("frame-src", CHAINCLOUD_ORIGIN);
  ensureCspSource("frame-src", TURNSTILE_ORIGIN);
  ensureCspSource("img-src", QR_IMAGE_ORIGIN);

  if (!isCheck && changed) write(htmlPath, html);
  return changed;
}

function installClient(platform, isCheck) {
  const root = appRootFor(platform);
  const assetsDir = path.join(root, "webview", "assets");
  const target = path.join(assetsDir, CLIENT_FILE);
  const source = jsClientSource();
  const changed = !fs.existsSync(target) || read(target) !== source;
  if (!isCheck && changed) write(target, source);
  return changed;
}

function patchPreload(platform, isCheck) {
  const root = appRootFor(platform);
  const preloadPath = path.join(root, ".vite", "build", "preload.js");
  if (!fs.existsSync(preloadPath)) return false;
  let source = read(preloadPath);
  if (
    source.includes("chaincloudRequest:") &&
    source.includes("chaincloudSiteLogin:") &&
    source.includes("chaincloudSiteLogout:") &&
    source.includes("chaincloudWriteConfig:")
  ) {
    return false;
  }

  if (source.includes("chaincloudSiteLogin:") && source.includes("getSentryInitOptions")) {
    if (source.includes("chaincloudSiteLogout:")) {
      source = source.replace(
        /(chaincloudSiteLogout:async\(\)=>e\.ipcRenderer\.invoke\([^)]+\),)(getSentryInitOptions)/,
        `$1chaincloudWriteConfig:async()=>e.ipcRenderer.invoke(${JSON.stringify(CHAINCLOUD_CONFIG_IPC_CHANNEL)}),$2`,
      );
    } else {
      source = source.replace(
        /(chaincloudSiteLogin:async\(\)=>e\.ipcRenderer\.invoke\([^)]+\),)(getSentryInitOptions)/,
        `$1chaincloudSiteLogout:async()=>e.ipcRenderer.invoke(${JSON.stringify(CHAINCLOUD_LOGOUT_IPC_CHANNEL)}),chaincloudWriteConfig:async()=>e.ipcRenderer.invoke(${JSON.stringify(CHAINCLOUD_CONFIG_IPC_CHANNEL)}),$2`,
      );
    }
    if (!isCheck) write(preloadPath, source);
    return true;
  }

  const needle = "triggerSentryTestError:async()=>{await e.ipcRenderer.invoke(l)},getSentryInitOptions";
  if (!source.includes(needle)) throw new Error("Unable to locate preload bridge object");
  source = source.replace(
    needle,
    `triggerSentryTestError:async()=>{await e.ipcRenderer.invoke(l)},chaincloudRequest:async t=>e.ipcRenderer.invoke(${JSON.stringify(CHAINCLOUD_IPC_CHANNEL)},t),chaincloudSiteLogin:async()=>e.ipcRenderer.invoke(${JSON.stringify(CHAINCLOUD_LOGIN_IPC_CHANNEL)}),chaincloudSiteLogout:async()=>e.ipcRenderer.invoke(${JSON.stringify(CHAINCLOUD_LOGOUT_IPC_CHANNEL)}),chaincloudWriteConfig:async()=>e.ipcRenderer.invoke(${JSON.stringify(CHAINCLOUD_CONFIG_IPC_CHANNEL)}),getSentryInitOptions`,
  );

  if (!isCheck) write(preloadPath, source);
  return true;
}
module.exports = { installClient, patchHtml, patchPreload };
