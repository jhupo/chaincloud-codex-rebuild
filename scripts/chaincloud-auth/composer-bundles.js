const { appRootFor, fs, path, read, write } = require("../patch-util");
const { CHAINCLOUD_ORIGIN, CHAINCLOUD_PROVIDER_ID } = require("./constants");

function replaceFunctionBefore(source, functionName, nextFunctionName, replacement) {
  const start = source.indexOf(`function ${functionName}`);
  if (start < 0) return { source, changed: false };
  const end = source.indexOf(`function ${nextFunctionName}`, start + 1);
  if (end <= start) return { source, changed: false };
  return {
    source: source.slice(0, start) + replacement + source.slice(end),
    changed: true,
  };
}

function ensureProviderLink(source) {
  const start = source.indexOf("function Wm(e){");
  if (start < 0) return { source, changed: false };
  const end = source.indexOf("function Gm(e){", start);
  if (end <= start) return { source, changed: false };
  const replacement =
    "function Wm(e){let t=(0,$.c)(6),{name:n}=e;n=n===`OpenAI`?`\\u94fe\\u8def\\u4e91`:n;let r=n===`\\u94fe\\u8def\\u4e91`,i=r?`" +
    CHAINCLOUD_ORIGIN +
    "`:void 0,a;t[0]!==n||t[1]!==r?(a=(0,Q.jsx)(ja,{className:`h-token-button-composer max-w-40 rounded-full px-2 py-0 text-sm leading-[18px]`,children:r?(0,Q.jsx)(`a`,{href:i,target:`_blank`,rel:`noopener noreferrer`,className:`min-w-0 truncate whitespace-nowrap`,onClick:e=>{e.preventDefault(),e.stopPropagation(),Jt.dispatchMessage(`open-in-browser`,{url:i})},children:n}):(0,Q.jsx)(`span`,{\"data-tooltip-overflow-target\":!0,className:`min-w-0 truncate whitespace-nowrap`,children:n})}),t[0]=n,t[1]=r,t[2]=a):a=t[2];let o;return t[3]!==n||t[4]!==a?(o=(0,Q.jsx)(Dn,{tooltipContent:n,openWhen:`trigger-overflows`,children:a}),t[3]=n,t[4]=a,t[5]=o):o=t[5],o}";
  const existing = source.slice(start, end);
  if (existing === replacement) return { source, changed: false };
  return {
    source: source.slice(0, start) + replacement + source.slice(end),
    changed: true,
  };
}

function ensureFooterBilling(source) {
  let changed = false;
  const helper =
    "function ChainCloudFooterBilling(){let e=(0,$.c)(9),t=window.__chaincloudCodexAuth,n=t?.billingPopoverText?.()||t?.billingText?.()||`\\u4eca\\u65e5\\u6d88\\u8d39 -- \\u00b7 \\u5269\\u4f59\\u91d1\\u989d --`,[r,i]=(0,Z.useState)(n),a=t?.isLoggedIn?.()===!0,o;e[0]!==t?(o=()=>{let e=()=>{i(t?.billingPopoverText?.()||t?.billingText?.()||n)};e();let r=window.setInterval(e,15e3);return()=>window.clearInterval(r)},e[0]=t,e[1]=o):o=e[1],(0,Z.useEffect)(o,[t]);if(!a)return null;let s;e[2]===Symbol.for(`react.memo_cache_sentinel`)?(s=()=>{window.__chaincloudCodexAuth?.showRechargeDialog?.()},e[2]=s):s=e[2];let c;e[3]!==r||e[4]!==s?(c=(0,Q.jsx)(`button`,{type:`button`,className:`h-token-button-composer max-w-56 truncate rounded-full px-2 py-0 text-sm leading-[18px] text-token-description-foreground hover:text-token-foreground`,onClick:s,title:r,children:r}),e[3]=r,e[4]=s,e[5]=c):c=e[5];return c}\n";
  if (source.includes("function ChainCloudFooterBilling()") && !source.includes(helper)) {
    const result = replaceFunctionBefore(source, "ChainCloudFooterBilling()", "Um(e)", "");
    source = result.source;
    changed = changed || result.changed;
  }
  const insertAt = source.indexOf("function Um(e){");
  if (insertAt >= 0 && !source.includes("function ChainCloudFooterBilling()")) {
    source = source.slice(0, insertAt) + helper + source.slice(insertAt);
    changed = true;
  }

  while (source.includes("children:[P,(0,Q.jsx)(ChainCloudFooterBilling,{}),(0,Q.jsx)(ChainCloudFooterBilling,{}),F,r,I]")) {
    source = source.replace(
      "children:[P,(0,Q.jsx)(ChainCloudFooterBilling,{}),(0,Q.jsx)(ChainCloudFooterBilling,{}),F,r,I]",
      "children:[P,(0,Q.jsx)(ChainCloudFooterBilling,{}),F,r,I]",
    );
    changed = true;
  }
  if (source.includes("children:[P,F,r,I]")) {
    source = source.replace("children:[P,F,r,I]", "children:[P,(0,Q.jsx)(ChainCloudFooterBilling,{}),F,r,I]");
    changed = true;
  }

  return { source, changed };
}

function ensureProviderName(source) {
  let changed = false;
  const legacyNeedle = "if(t===`openai`)return `\\u94fe\\u8def\\u4e91`;";
  const legacyLiteralNeedle = "if(t===`openai`)return `链路云`;";
  const replacement = `if(t===\`${CHAINCLOUD_PROVIDER_ID}\`||t===\`openai\`)return \`\\u94fe\\u8def\\u4e91\`;`;
  if (source.includes(legacyNeedle) || source.includes(legacyLiteralNeedle)) {
    source = source.replace(legacyNeedle, replacement).replace(legacyLiteralNeedle, replacement);
    changed = true;
  }
  const providerNeedle = "let t=e.model_provider;if(t==null||t.length===0)return null;";
  if (source.includes(providerNeedle) && !source.includes(`t===\`${CHAINCLOUD_PROVIDER_ID}\``)) {
    source = source.replace(providerNeedle, providerNeedle + replacement);
    changed = true;
  }
  return { source, changed };
}

function ensureIdeContextIndicator(source) {
  if (source.includes("function Em(e,t){return !0}")) return { source, changed: false };
  if (!source.includes("function Em(e,t){return e&&t}")) return { source, changed: false };
  return {
    source: source.replace("function Em(e,t){return e&&t}", "function Em(e,t){return !0}"),
    changed: true,
  };
}

function patchComposerBundles(platform, isCheck) {
  const root = appRootFor(platform);
  const assetsDir = path.join(root, "webview", "assets");
  if (!fs.existsSync(assetsDir)) return [];
  const touched = [];
  for (const name of fs.readdirSync(assetsDir)) {
    if (!/^composer-(?!atoms-).*\.js$/.test(name)) continue;
    const file = path.join(assetsDir, name);
    let source = read(file);
    let changed = false;
    if (source.includes("ChainCloudInlineBilling")) {
      const helperStart = source.indexOf("function ChainCloudInlineBilling()");
      const helperEnd = helperStart >= 0 ? source.indexOf("function ", helperStart + 1) : -1;
      if (helperStart >= 0 && helperEnd > helperStart) {
        source = source.slice(0, helperStart) + source.slice(helperEnd);
        changed = true;
      }
      if (source.includes(",(0,Q.jsx)(ChainCloudInlineBilling,{})")) {
        source = source.replaceAll(",(0,Q.jsx)(ChainCloudInlineBilling,{})", "");
        changed = true;
      }
    }
    const staleComposerSwitcher =
      "let k=O;window.__chaincloudCodexSwitchApiKey=async e=>{await er(`login-with-api-key`,{hostId:a.hostId,apiKey:e})};let A=o?.authMethod===`copilot`,";
    if (source.includes(staleComposerSwitcher)) {
      source = source.replace(staleComposerSwitcher, "let k=O,A=o?.authMethod===`copilot`,");
      changed = true;
    }
    const providerName = ensureProviderName(source);
    source = providerName.source;
    changed = changed || providerName.changed;

    const providerLink = ensureProviderLink(source);
    source = providerLink.source;
    changed = changed || providerLink.changed;

    const footerBilling = ensureFooterBilling(source);
    source = footerBilling.source;
    changed = changed || footerBilling.changed;

    const ideContextIndicator = ensureIdeContextIndicator(source);
    source = ideContextIndicator.source;
    changed = changed || ideContextIndicator.changed;
    if (changed) {
      if (!isCheck) write(file, source);
      touched.push(file);
    }
  }
  return touched;
}
module.exports = { patchComposerBundles };
