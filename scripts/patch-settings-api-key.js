const { appRootFor, fs, matchOne, path, read, write } = require("./patch-util");

function patchAgentSettingsBundle(platform, isCheck) {
  const root = appRootFor(platform);
  const assetsDir = path.join(root, "webview", "assets");
  if (!fs.existsSync(assetsDir)) return { file: null, changed: false };
  const fileName = fs.readdirSync(assetsDir).find((name) => /^agent-settings-.*\.js$/.test(name));
  if (!fileName) return { file: null, changed: false };
  const file = path.join(assetsDir, fileName);
  let source = read(file);

  const reactHookMatch =
    source.match(/var\s+(\w+)=y\(\),(\w+)=e\(s\(\),1\);/) ||
    source.match(/var\s+(\w+)=_\(\),(\w+)=e\(s\(\),1\);/);
  if (!reactHookMatch) throw new Error("Unable to locate AgentSettings React aliases");
  const reactName = reactHookMatch[2];
  const jsxFactory = matchOne(source, /import\{n as \w+,t as (\w+)\}from"\.\/jsx-runtime-[^"]+\.js"/, "jsx factory alias")[1];
  const jsxName = matchOne(source, new RegExp(`var\\s+(\\w+)=${jsxFactory}\\(\\)`), "jsx alias")[1];
  const intlName = matchOne(source, /import\{[^}]*W as (\w+)[^}]*\}from"\.\/setting-storage-[^"]+\.js"/, "settings intl alias")[1];
  const rowName = matchOne(source, /import\{n as (\w+)\}from"\.\/settings-row-[^"]+\.js"/, "settings row alias")[1];
  const requestFn = matchOne(source, /import\{Ca as \w+,ts as (\w+)\}from"\.\/app-server-manager-signals-[^"]+\.js"/, "app-server request alias")[1];
  const dropdownMatch = matchOne(source, /import\{r as (\w+),t as (\w+)\}from"\.\/dropdown-[^"]+\.js"/, "dropdown aliases");
  const dropdownRoot = dropdownMatch[1];
  const dropdownMenu = dropdownMatch[2];
  const checkIcon = matchOne(source, /import\{t as (\w+)\}from"\.\/check-md-[^"]+\.js"/, "check icon alias")[1];
  const sharedMatch = matchOne(source, /import\{i as (\w+),t as (\w+)\}from"\.\/settings-shared-[^"]+\.js"/, "settings shared aliases");
  const sharedButton = sharedMatch[2];

  if (
    source.includes("function ChainCloudApiKeySettingsRow({hostId:ccHostId})") &&
    source.includes("function ChainCloudApplyApiKey") &&
    source.includes("function ChainCloudEnsureCodexConfig") &&
    source.includes("batch-write-config-value") &&
    !source.includes("switchDesktopApiKey?.(t)") &&
    !source.includes("s(e?.getSession?.()??null),h()")
  ) {
    return { file, changed: false };
  }

  if (source.includes("function ChainCloudApiKeySettingsRow")) {
    source = source.replace(/function ChainCloudApiKeyId\(e\)[\s\S]*?(?=function\s+\w+\(\{hostId:e\}\)\{)/, "");
    source = source.replace(new RegExp(`\\(0,${jsxName}\\.jsx\\)\\(ChainCloudApiKeySettingsRow,\\{\\}\\),`), "");
    source = source.replace(new RegExp(`\\(0,${jsxName}\\.jsx\\)\\(ChainCloudApiKeySettingsRow,\\{hostId:e\\}\\),`), "");
  }

  const helper = `function ChainCloudApiKeyId(e){return String(e?.key??e?.id??\`\`)}function ChainCloudApiKeyLabel(e){let t=e?.name||\`Key\`,n=String(e?.key||\`\`),r=n.length>12?n.slice(0,7)+\`...\`+n.slice(-4):n;return r?\`\${t} (\${r})\`:t}function ChainCloudApiKeyList(e){let t=Array.isArray(e)?e:Array.isArray(e?.items)?e.items:Array.isArray(e?.data)?e.data:Array.isArray(e?.records)?e.records:[];return t.filter(e=>e&&e.key&&(e.status==null||e.status===\`active\`))}async function ChainCloudApplyApiKey(e,t,n){await ${requestFn}(\`login-with-api-key\`,{hostId:t,apiKey:n}),await e?.applyCodexConfig?.(e=>${requestFn}(\`batch-write-config-value\`,{hostId:t,...e}))}async function ChainCloudEnsureCodexConfig(e,t,n){let r=n?.selectedApiKey?.key;if(r)await ChainCloudApplyApiKey(e,t,r)}function ChainCloudApiKeySettingsRow({hostId:ccHostId}){let e=window.__chaincloudCodexAuth,t=${intlName}(),n=${reactName}.useState([]),r=n[0],i=n[1],a=${reactName}.useState(()=>e?.getSession?.()??null),o=a[0],s=a[1],c=${reactName}.useState(!1),l=c[0],u=c[1],d=${reactName}.useState(null),p=d[0],m=d[1],h=${reactName}.useCallback(async()=>{if(!e?.isLoggedIn?.()){i([]),s(null);return}u(!0),m(null);try{let t=ChainCloudApiKeyList(await e.listKeys?.());i(t);let n=e.getSession?.()??null;if(!n?.selectedApiKey&&t[0]){e.setSelectedApiKey?.(t[0]);await ChainCloudApplyApiKey(e,ccHostId,t[0].key);n=e.getSession?.()??n}else await ChainCloudEnsureCodexConfig(e,ccHostId,n);s(n)}catch(e){m(e?.message||String(e))}finally{u(!1)}},[e,ccHostId]);${reactName}.useEffect(()=>{h();let t=()=>{s(e?.getSession?.()??null)},n=()=>{t(),h()};return window.addEventListener(\`chaincloud-auth-changed\`,n),window.addEventListener(\`chaincloud-api-key-selected\`,t),()=>{window.removeEventListener(\`chaincloud-auth-changed\`,n),window.removeEventListener(\`chaincloud-api-key-selected\`,t)}},[h,e]);if(!e?.isLoggedIn?.())return null;let g=ChainCloudApiKeyId(o?.selectedApiKey),_=r.find(e=>ChainCloudApiKeyId(e)===g)||r[0]||null,v=_?ChainCloudApiKeyId(_):g,y=l||r.length===0,b=p?(0,${jsxName}.jsx)(\`div\`,{className:\`text-sm text-token-error-foreground\`,children:p}):null;return(0,${jsxName}.jsx)(${rowName},{label:\`API \\u5bc6\\u94a5\`,description:(0,${jsxName}.jsxs)(\`div\`,{className:\`flex flex-col gap-1\`,children:[(0,${jsxName}.jsx)(\`div\`,{children:\`\\u9009\\u62e9\\u5f53\\u524d\\u7528\\u4e8e\\u8bf7\\u6c42\\u7684\\u94fe\\u8def\\u4e91 API \\u5bc6\\u94a5\`}),b]}),control:(0,${jsxName}.jsx)(${dropdownMenu},{align:\`end\`,contentWidth:\`panelWide\`,disabled:y,triggerButton:(0,${jsxName}.jsx)(${sharedButton},{disabled:y,contentClassName:\`truncate\`,children:l?\`\\u52a0\\u8f7d Key...\`:_?ChainCloudApiKeyLabel(_):\`\\u65e0\\u53ef\\u7528 Key\`}),children:r.map(t=>{let n=ChainCloudApiKeyId(t);return(0,${jsxName}.jsx)(${dropdownRoot}.Item,{RightIcon:n===v?${checkIcon}:void 0,onSelect:()=>{u(!0),m(null),e?.setSelectedApiKey?.(t),s(e?.getSession?.()??{selectedApiKey:t}),Promise.resolve(ChainCloudApplyApiKey(e,ccHostId,t.key)).then(()=>s(e?.getSession?.()??{selectedApiKey:t})).catch(e=>m(e?.message||String(e))).finally(()=>u(!1))},children:(0,${jsxName}.jsx)(\`span\`,{className:\`text-sm\`,children:ChainCloudApiKeyLabel(t)})},n)})})})}`;
  const functionNeedleMatch = source.match(/function\s+\w+\(\{hostId:e\}\)\{[\s\S]{0,9000}?settings\.agent\.configuration\.approval\.label/);
  if (!functionNeedleMatch) throw new Error("Unable to locate AgentSettings configuration component");
  const functionNeedle = functionNeedleMatch[0].match(/function\s+\w+\(\{hostId:e\}\)/)[0];
  source = source.replace(functionNeedle, helper + functionNeedle);

  const rowNeedle = `(0,${jsxName}.jsx)(${rowName},{label:(0,${jsxName}.jsx)(l,{id:\`settings.agent.configuration.approval.label\``;
  if (!source.includes(rowNeedle)) throw new Error("Unable to locate approval policy settings row");
  source = source.replace(rowNeedle, `(0,${jsxName}.jsx)(ChainCloudApiKeySettingsRow,{hostId:e}),` + rowNeedle);

  if (!isCheck) write(file, source);
  return { file, changed: true };
}

module.exports = { patchAgentSettingsBundle };
