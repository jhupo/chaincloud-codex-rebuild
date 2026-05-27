const { appRootFor, fs, path, read, write } = require("../patch-util");
const {
  CHAINCLOUD_API_BASE,
  CHAINCLOUD_CONFIG_IPC_CHANNEL,
  CHAINCLOUD_IPC_CHANNEL,
  CHAINCLOUD_LOGIN_IPC_CHANNEL,
  CHAINCLOUD_LOGOUT_IPC_CHANNEL,
  CHAINCLOUD_OPENAI_BASE_URL,
  CHAINCLOUD_ORIGIN,
  CHAINCLOUD_PROVIDER_ID,
} = require("./constants");
function patchMainProxy(platform, isCheck) {
  const root = appRootFor(platform);
  const mainDir = path.join(root, ".vite", "build");
  if (!fs.existsSync(mainDir)) return { file: null, changed: false };
  const candidates = fs
    .readdirSync(mainDir)
    .filter((file) => /^main-.*\.js$/.test(file))
    .sort()
    .map((file) => path.join(mainDir, file));
  if (candidates.length === 0) return { file: null, changed: false };
  const file = candidates[0];
  let source = read(file);
  const original = source;
  const marker = "var w=/^[a-z0-9-_]+$/i;";
  const markerIndex = source.lastIndexOf(marker);
  if (markerIndex < 0) throw new Error("Unable to locate main bundle insertion point");
  const injectionStarts = [
    "var __chaincloudAuthIpcChannel=",
    "var __CHAINCLOUD_AUTH_PROXY_",
  ]
    .map((needle) => source.indexOf(needle))
    .filter((index) => index >= 0 && index < markerIndex);
  const stripStart = injectionStarts.length > 0 ? Math.min(...injectionStarts) : markerIndex;
  source = source.slice(0, stripStart) + source.slice(markerIndex);

  const proxy = `
var __CHAINCLOUD_AUTH_PROXY_V11__ = true;
var __chaincloudElectronV11 = require("electron");
var __chaincloudPathV11 = require("path");
var __chaincloudOsV11 = require("os");
var __chaincloudFsPromisesV11 = require("fs").promises;
var __chaincloudAuthIpcChannelV10 = ${JSON.stringify(CHAINCLOUD_IPC_CHANNEL)};
var __chaincloudConfigIpcChannelV10 = ${JSON.stringify(CHAINCLOUD_CONFIG_IPC_CHANNEL)};
var __chaincloudLoginIpcChannelV10 = ${JSON.stringify(CHAINCLOUD_LOGIN_IPC_CHANNEL)};
var __chaincloudLogoutIpcChannelV10 = ${JSON.stringify(CHAINCLOUD_LOGOUT_IPC_CHANNEL)};
var __chaincloudProviderIdV10 = ${JSON.stringify(CHAINCLOUD_PROVIDER_ID)};
var __chaincloudLoginPartitionV10 = "chaincloud-login";
var __chaincloudLoginViewV10 = null;
var __chaincloudLoginPromiseV10 = null;
function __chaincloudIsAllowedLoginUrlV10(rawUrl) {
  try { return new URL(rawUrl).origin === ${JSON.stringify(CHAINCLOUD_ORIGIN)}; }
  catch { return false; }
}
function __chaincloudReadSiteSessionV10(webContents) {
  return webContents.executeJavaScript(\`(() => {
    try {
      let access_token = localStorage.getItem("auth_token") || "";
      let refresh_token = localStorage.getItem("refresh_token") || "";
      let token_expires_at = localStorage.getItem("token_expires_at") || "";
      let auth_user = localStorage.getItem("auth_user") || "";
      return { access_token, refresh_token, token_expires_at: token_expires_at ? Number(token_expires_at) : 0, user: auth_user ? JSON.parse(auth_user) : null };
    } catch (error) {
      return { error: error && error.message || String(error) };
    }
  })()\`, true);
}
function __chaincloudRemoveHandlerV10(channel) {
  try { __chaincloudElectronV11.ipcMain.removeHandler(channel); } catch {}
}
function __chaincloudTomlStringV10(value) {
  return JSON.stringify(String(value));
}
function __chaincloudEscapeRegExpV10(value) {
  return String(value).replace(/[\\\\^$.*+?()[\\]{}|]/g, "\\\\$&");
}
function __chaincloudSetTomlScalarV10(source, key, value) {
  let line = key + " = " + __chaincloudTomlStringV10(value);
  let pattern = new RegExp("(^|\\\\n)" + __chaincloudEscapeRegExpV10(key) + "\\\\s*=.*(?=\\\\n|$)");
  if (pattern.test(source)) return source.replace(pattern, "$1" + line);
  return source.replace(/^\\s*/, "") ? line + "\\n" + source : line + "\\n";
}
function __chaincloudFindTomlTableV10(source, tableName) {
  let escaped = __chaincloudEscapeRegExpV10(tableName);
  let pattern = new RegExp("(^|\\\\n)\\\\[" + escaped + "\\\\][\\\\s\\\\S]*?(?=\\\\n\\\\[[^\\\\n]+\\\\]|$)");
  let match = pattern.exec(source);
  return match ? { start: match.index + match[1].length, end: match.index + match[0].length, text: match[0].slice(match[1].length) } : null;
}
function __chaincloudSetTomlTableScalarV10(source, tableName, key, value) {
  let table = __chaincloudFindTomlTableV10(source, tableName);
  let line = key + " = " + __chaincloudTomlStringV10(value);
  if (!table) {
    let prefix = source.replace(/\\s+$/, "");
    return prefix + (prefix ? "\\n\\n" : "") + "[" + tableName + "]\\n" + line + "\\n";
  }
  let body = table.text;
  let pattern = new RegExp("(^|\\\\n)" + __chaincloudEscapeRegExpV10(key) + "\\\\s*=.*(?=\\\\n|$)");
  let nextBody = pattern.test(body) ? body.replace(pattern, "$1" + line) : body.replace(/\\s*$/, "") + "\\n" + line;
  return source.slice(0, table.start) + nextBody + source.slice(table.end);
}
function __chaincloudEnsureConfigTextV10(source) {
  let text = String(source || "").replace(/\\r\\n/g, "\\n");
  text = __chaincloudSetTomlScalarV10(text, "model_provider", __chaincloudProviderIdV10);
  let tableName = "model_providers." + __chaincloudProviderIdV10;
  text = __chaincloudSetTomlTableScalarV10(text, tableName, "name", "\\u94fe\\u8def\\u4e91");
  text = __chaincloudSetTomlTableScalarV10(text, tableName, "base_url", ${JSON.stringify(CHAINCLOUD_OPENAI_BASE_URL)});
  text = __chaincloudSetTomlTableScalarV10(text, tableName, "wire_api", "responses");
  return text.replace(/\\s+$/, "") + "\\n";
}
async function __chaincloudWriteConfigTomlV10() {
  let codexHome = process.env.CODEX_HOME && process.env.CODEX_HOME.trim() ? process.env.CODEX_HOME : __chaincloudPathV11.join(__chaincloudOsV11.homedir(), ".codex");
  let configPath = __chaincloudPathV11.join(codexHome, "config.toml");
  await __chaincloudFsPromisesV11.mkdir(codexHome, { recursive: true });
  let current = "";
  try { current = await __chaincloudFsPromisesV11.readFile(configPath, "utf8"); } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }
  let next = __chaincloudEnsureConfigTextV10(current);
  if (next !== String(current || "").replace(/\\r\\n/g, "\\n")) await __chaincloudFsPromisesV11.writeFile(configPath, next.replace(/\\n/g, "\\r\\n"), "utf8");
  return { ok: true, path: configPath };
}
async function __chaincloudClearLoginSessionV10() {
  try {
    let session = __chaincloudElectronV11.session.fromPartition(__chaincloudLoginPartitionV10);
    await session.clearStorageData();
    await session.clearCache?.();
  } catch {}
}
function __chaincloudSetLoginViewBoundsV10(parentWindow, loginView) {
  try {
    let size = parentWindow.getContentSize();
    loginView.setBounds({ x: 0, y: 0, width: size[0], height: size[1] });
    __chaincloudFitLoginPageV10(parentWindow, loginView);
  } catch {}
}
async function __chaincloudFitLoginPageV10(parentWindow, loginView) {
  try {
    let size = parentWindow.getContentSize();
    let scale = Math.min(1, Math.max(0.72, size[1] / 824));
    loginView.webContents.setZoomFactor(scale);
    await loginView.webContents.insertCSS([
      "html, body { width: 100% !important; height: 100% !important; overflow: hidden !important; }",
      "body > div:first-child { min-height: 100vh !important; height: 100vh !important; overflow: hidden !important; }",
      "* { scrollbar-width: none !important; }",
      "*::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }"
    ].join("\\n"));
  } catch {}
}
function __chaincloudDestroyLoginViewV10(parentWindow, loginView) {
  try { parentWindow?.removeBrowserView?.(loginView); } catch {}
  try { if (parentWindow?.getBrowserView?.() === loginView) parentWindow.setBrowserView(null); } catch {}
  try { loginView?.webContents?.destroy?.(); } catch {}
  if (__chaincloudLoginViewV10 === loginView) __chaincloudLoginViewV10 = null;
}
function __installChaincloudAuthProxyV10() {
  if (globalThis.__chaincloudAuthProxyV10Installed) return;
  globalThis.__chaincloudAuthProxyV10Installed = true;
  __chaincloudRemoveHandlerV10(__chaincloudAuthIpcChannelV10);
  __chaincloudRemoveHandlerV10(__chaincloudConfigIpcChannelV10);
  __chaincloudRemoveHandlerV10(__chaincloudLoginIpcChannelV10);
  __chaincloudRemoveHandlerV10(__chaincloudLogoutIpcChannelV10);
  __chaincloudElectronV11.ipcMain.handle(__chaincloudConfigIpcChannelV10, async () => __chaincloudWriteConfigTomlV10());
  __chaincloudElectronV11.ipcMain.handle(__chaincloudAuthIpcChannelV10, async (event, request) => {
    if (request == null || typeof request !== "object") throw Error("Invalid ChainCloud request");
    let requestPath = String(request.path || "");
    if (!requestPath.startsWith("/") || requestPath.startsWith("//")) throw Error("Invalid ChainCloud path");
    let url = new URL(${JSON.stringify(CHAINCLOUD_API_BASE)} + requestPath);
    if (url.origin !== ${JSON.stringify(CHAINCLOUD_ORIGIN)} || !url.pathname.startsWith("/api/v1/")) throw Error("Blocked ChainCloud URL");
    let method = String(request.method || "GET").toUpperCase();
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) throw Error("Blocked ChainCloud method");
    let headers = {};
    for (let [key, value] of Object.entries(request.headers || {})) {
      let lower = key.toLowerCase();
      if (lower === "content-type" || lower === "authorization" || lower === "accept-language") headers[key] = String(value);
    }
    let init = { method, headers };
    if (request.body != null) {
      init.body = String(request.body);
      if (init.body.length > 1024 * 1024) throw Error("ChainCloud request body too large");
    }
    let controller = new AbortController();
    let timeout = setTimeout(() => controller.abort(), 30000);
    try {
      init.signal = controller.signal;
      let response = await __chaincloudElectronV11.net.fetch(url.toString(), init);
      let text = await response.text();
      return { ok: response.ok, status: response.status, statusText: response.statusText, text };
    } finally {
      clearTimeout(timeout);
    }
  });
  __chaincloudElectronV11.ipcMain.handle(__chaincloudLogoutIpcChannelV10, async () => {
    await __chaincloudClearLoginSessionV10();
    return true;
  });
  __chaincloudElectronV11.ipcMain.handle(__chaincloudLoginIpcChannelV10, async (event) => {
    if (__chaincloudLoginViewV10 && !__chaincloudLoginViewV10.webContents?.isDestroyed?.()) {
      try { __chaincloudLoginViewV10.webContents.focus(); } catch {}
      return __chaincloudLoginPromiseV10;
    }
    __chaincloudLoginPromiseV10 = new Promise((resolve, reject) => {
    let done = false;
    let cleanup = () => {};
    void (async () => {
    let parentWindow = __chaincloudElectronV11.BrowserWindow.fromWebContents(event.sender);
    if (!parentWindow) throw Error("ChainCloud login parent window unavailable");
    let previousTitle = "";
    try { previousTitle = parentWindow.getTitle?.() || ""; parentWindow.setTitle?.("Login - ChainCloud"); } catch {}
    let loginView = new __chaincloudElectronV11.BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: __chaincloudLoginPartitionV10,
      },
    });
    try { loginView.webContents.setBackgroundColor("#08111f"); } catch {}
    __chaincloudLoginViewV10 = loginView;
    let pollTimer = null;
    let loadTimer = null;
    let resizeHandler = () => __chaincloudSetLoginViewBoundsV10(parentWindow, loginView);
    cleanup = () => {
      try {
        parentWindow.off?.("resize", resizeHandler);
        parentWindow.off?.("closed", parentClosedHandler);
      } catch {}
      if (pollTimer) clearInterval(pollTimer);
      if (loadTimer) clearTimeout(loadTimer);
      __chaincloudDestroyLoginViewV10(parentWindow, loginView);
      try { if (previousTitle) parentWindow.setTitle?.(previousTitle); } catch {}
      if (__chaincloudLoginPromiseV10) __chaincloudLoginPromiseV10 = null;
    };
    let parentClosedHandler = () => {
      done = true;
      cleanup();
      reject(Error("ChainCloud login cancelled"));
    };
    let checkSession = async () => {
      if (done || loginView.webContents.isDestroyed()) return;
      let sessionData;
      try { sessionData = await __chaincloudReadSiteSessionV10(loginView.webContents); } catch { return; }
      if (sessionData?.access_token) {
        done = true;
        cleanup();
        resolve(sessionData);
      }
    };
    parentWindow.setBrowserView(loginView);
    resizeHandler();
    parentWindow.on?.("resize", resizeHandler);
    parentWindow.on?.("closed", parentClosedHandler);
    loginView.webContents.setWindowOpenHandler?.(({ url }) => ({ action: __chaincloudIsAllowedLoginUrlV10(url) ? "allow" : "deny" }));
    loginView.webContents.on("will-navigate", (navEvent, url) => {
      if (!__chaincloudIsAllowedLoginUrlV10(url)) navEvent.preventDefault();
    });
    loginView.webContents.on("dom-ready", async () => {
      if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
      await __chaincloudFitLoginPageV10(parentWindow, loginView);
      await checkSession();
    });
    loginView.webContents.on("did-finish-load", async () => {
      if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
      await __chaincloudFitLoginPageV10(parentWindow, loginView);
      await checkSession();
    });
    loginView.webContents.on("did-fail-load", (loadEvent, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || done) return;
      if (errorCode === -3) return;
      done = true;
      cleanup();
      reject(Error(errorDescription || "ChainCloud login page failed to load"));
    });
    loginView.webContents.on("render-process-gone", (_goneEvent, details) => {
      if (done) return;
      done = true;
      cleanup();
      reject(Error("ChainCloud login renderer exited: " + (details?.reason || "unknown")));
    });
    loginView.webContents.on("did-navigate", async () => { await __chaincloudFitLoginPageV10(parentWindow, loginView); await checkSession(); });
    loginView.webContents.on("did-navigate-in-page", async () => { await __chaincloudFitLoginPageV10(parentWindow, loginView); await checkSession(); });
    pollTimer = setInterval(checkSession, 1000);
    pollTimer.unref?.();
    loadTimer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(Error("ChainCloud login page timed out"));
    }, 45000);
    loadTimer.unref?.();
    loginView.webContents.loadURL(${JSON.stringify(CHAINCLOUD_ORIGIN + "/login")}).catch((error) => {
      done = true;
      cleanup();
      reject(error);
    });
    })().catch((error) => {
      done = true;
      try { cleanup(); } catch {}
      reject(error);
    });
    });
    return __chaincloudLoginPromiseV10;
  });
}
__installChaincloudAuthProxyV10();
`;
  const existingInjection = injectionStarts.length > 0 ? original.slice(stripStart, markerIndex) : "";
  if (existingInjection.replace(/\s+/g, "") === proxy.replace(/\s+/g, "")) {
    return { file, changed: false };
  }
  source = source.replace(marker, () => proxy + marker);

  const changed = source !== original;
  if (!isCheck && changed) write(file, source);
  return { file, changed };
}
module.exports = { patchMainProxy };
