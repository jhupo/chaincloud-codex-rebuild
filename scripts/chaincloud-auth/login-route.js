const { appRootFor, fs, matchOne, path, read, write } = require("../patch-util");

function findLoginBundle(platform) {
  const root = appRootFor(platform);
  const assetsDir = path.join(root, "webview", "assets");
  for (const file of fs.readdirSync(assetsDir)) {
    if (!/^login-route-.*\.js$/.test(file)) continue;
    const full = path.join(assetsDir, file);
    const source = read(full);
    if (source.includes("login-with-api-key") && source.includes("LoginRoute")) return full;
  }
  return null;
}

function patchStartupAuthGate(platform, isCheck) {
  const root = appRootFor(platform);
  const assetsDir = path.join(root, "webview", "assets");
  if (!fs.existsSync(assetsDir)) return { file: null, changed: false };
  const fileName = fs.readdirSync(assetsDir).find((name) => /^app-main-.*\.js$/.test(name));
  if (!fileName) return { file: null, changed: false };
  const file = path.join(assetsDir, fileName);
  let source = read(file);

  const alreadyPatched = "if((t||!n)&&window.__chaincloudCodexAuth?.isLoggedIn?.()){";
  if (source.includes(alreadyPatched)) return { file, changed: false };

  const nativeGate = "if(t||!n){";
  const guardStart = source.indexOf("function qw(){");
  const guardEnd = guardStart >= 0 ? source.indexOf("var Jw=", guardStart) : -1;
  if (guardStart < 0 || guardEnd < guardStart) {
    throw new Error("Unable to locate startup auth guard");
  }
  const before = source.slice(0, guardStart);
  let guard = source.slice(guardStart, guardEnd);
  const after = source.slice(guardEnd);
  if (!guard.includes(nativeGate)) throw new Error("Unable to locate startup auth condition");
  guard = guard.replace(nativeGate, alreadyPatched);
  source = before + guard + after;

  if (!isCheck) write(file, source);
  return { file, changed: true };
}

function patchLoginRoute(platform, isCheck) {
  const file = findLoginBundle(platform);
  if (!file) return { file: null, changed: false };
  let source = read(file);
  if (
    source.includes("__CHAINCLOUD_NATIVE_LOGIN_V9__") &&
    source.includes("batch-write-config-value")
  ) {
    return { file, changed: false };
  }

  const react = source.match(/var\s+\w+=h\(\),(\w+)=e\(o\(\),1\),(\w+)=s\(\);/)
    || source.match(/var\s+\w+=_\(\),(\w+)=e\(s\(\),1\),(\w+)=c\(\);/);
  if (!react) throw new Error("Unable to locate React/jsx aliases");
  const reactName = react[1];
  const jsxName = react[2];
  const authHook = matchOne(source, /import\{[^}]*t as (\w+)[^}]*\}from"\.\/use-auth-[^"]+\.js"/, "use-auth hook")[1];
  const apiKeyLogin = matchOne(source, /await\s+(\w+)\(`login-with-api-key`,\{hostId:(\w+),apiKey:[^}]+}\)/, "API key login call");
  const requestFn = apiKeyLogin[1];
  const hostId = apiKeyLogin[2];
  const navigateHook = matchOne(source, /import\{f as (\w+)\}from"\.\/chunk-[^"]+\.js"/, "navigate hook")[1];

  const component = `
function ChainCloudLoginRoute(){let ccJsx=${jsxName},ccAuth=${authHook}(),ccNavigate=${navigateHook}(),[ccState,ccSetState]=${reactName}.useState("opening"),[ccAttempt,ccSetAttempt]=${reactName}.useState(0);${reactName}.useEffect(()=>{let ccCancelled=!1,ccTimer=null,ccStart=async()=>{if(ccCancelled)return;let ccBridge=window.electronBridge?.chaincloudSiteLogin,ccApi=window.__chaincloudCodexAuth;if(typeof ccBridge!=="function"||!ccApi?.completeSiteLogin||!ccApi?.ensureDesktopApiKey){ccTimer=setTimeout(ccStart,200);return}try{let ccSession=await ccBridge();if(ccCancelled)return;await ccApi.completeSiteLogin(ccSession);let ccKey=await ccApi.ensureDesktopApiKey();if(ccCancelled)return;await ${requestFn}("login-with-api-key",{hostId:${hostId},apiKey:ccKey.key});await ccApi.applyCodexConfig?.(ccPayload=>${requestFn}("batch-write-config-value",{hostId:${hostId},...ccPayload}));ccAuth.setAuthMethod("apikey");ccNavigate("/welcome",{replace:!0})}catch(ccErr){if(!ccCancelled){console.error("[ChainCloud] native login failed",ccErr);ccSetState("error")}}};ccStart();return()=>{ccCancelled=!0;ccTimer&&clearTimeout(ccTimer)}},[ccAttempt]);let ccRetry=()=>{ccSetState("opening");ccSetAttempt(ccValue=>ccValue+1)};return ccJsx.jsx("div",{"data-chaincloud-login":"__CHAINCLOUD_NATIVE_LOGIN_V9__",className:"fixed inset-0 flex items-center justify-center bg-token-main-surface-primary px-4 text-token-foreground",children:ccJsx.jsxs("div",{className:"flex w-full max-w-[360px] flex-col items-center gap-4 text-center",children:[ccJsx.jsx("div",{className:"text-base font-semibold",children:"\\u6b63\\u5728\\u6253\\u5f00\\u94fe\\u8def\\u4e91\\u767b\\u5f55"}),ccJsx.jsx("div",{className:"text-sm text-token-description-foreground",children:ccState==="error"?"\\u767b\\u5f55\\u7a97\\u53e3\\u5df2\\u5173\\u95ed\\u6216\\u767b\\u5f55\\u5931\\u8d25":"\\u8bf7\\u5728\\u5f39\\u51fa\\u7684\\u7ad9\\u70b9\\u9875\\u9762\\u4e2d\\u5b8c\\u6210\\u9a8c\\u8bc1\\u548c\\u767b\\u5f55"}),ccState==="error"?ccJsx.jsx("button",{type:"button",className:"h-10 rounded-full bg-token-foreground px-5 text-sm font-medium text-token-main-surface-primary",onClick:ccRetry,children:"\\u91cd\\u65b0\\u6253\\u5f00\\u767b\\u5f55"}):null]})})}
`;

  if (source.includes("function ChainCloudLoginRoute")) {
    const start = source.indexOf("function ChainCloudLoginRoute");
    const exportStart = source.indexOf("export{ChainCloudLoginRoute as LoginRoute};", start);
    if (start < 0 || exportStart < 0) throw new Error("Unable to locate ChainCloudLoginRoute export");
    const exportEnd = exportStart + "export{ChainCloudLoginRoute as LoginRoute};".length;
    source = source.slice(0, start) + component + "export{ChainCloudLoginRoute as LoginRoute};" + source.slice(exportEnd);
  } else {
    const exportMatch = matchOne(source, /export\{(\w+) as LoginRoute\};/, "LoginRoute export");
    const exportName = exportMatch[1];
    const start = source.indexOf(`function ${exportName}()`);
    const exportStart = source.indexOf(exportMatch[0], start);
    if (start < 0 || exportStart < 0) throw new Error("Unable to locate LoginRoute function");
    const exportEnd = exportStart + exportMatch[0].length;
    source = source.slice(0, start) + component + "export{ChainCloudLoginRoute as LoginRoute};" + source.slice(exportEnd);
  }

  if (!isCheck) write(file, source);
  return { file, changed: true };
}
module.exports = { findLoginBundle, patchLoginRoute, patchStartupAuthGate };
