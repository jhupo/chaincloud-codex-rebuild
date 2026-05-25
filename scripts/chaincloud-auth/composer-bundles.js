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
  if (source.includes("function ChainCloudFooterBilling()")) {
    const helperStart = source.indexOf("function ChainCloudFooterBilling(){");
    const helperEnd = helperStart >= 0 ? source.indexOf("function Um(e){", helperStart + 1) : -1;
    if (helperEnd > helperStart) {
      source = source.slice(0, helperStart) + source.slice(helperEnd);
      changed = true;
    }
  }

  while (source.includes("children:[P,(0,Q.jsx)(ChainCloudFooterBilling,{}),(0,Q.jsx)(ChainCloudFooterBilling,{}),F,r,I]")) {
    source = source.replace(
      "children:[P,(0,Q.jsx)(ChainCloudFooterBilling,{}),(0,Q.jsx)(ChainCloudFooterBilling,{}),F,r,I]",
      "children:[P,(0,Q.jsx)(ChainCloudFooterBilling,{}),F,r,I]",
    );
    changed = true;
  }
  if (source.includes("children:[P,(0,Q.jsx)(ChainCloudFooterBilling,{}),F,r,I]")) {
    source = source.replace("children:[P,(0,Q.jsx)(ChainCloudFooterBilling,{}),F,r,I]", "children:[P,F,r,I]");
    changed = true;
  }
  if (source.includes("ChainCloudFooterBilling")) {
    throw new Error("Failed to remove ChainCloud footer billing");
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

function ensureIdeContextHidden(source) {
  if (source.includes("function Em(e,t){return !1}")) return { source, changed: false };
  if (source.includes("function Em(e,t){return !0}")) {
    return {
      source: source.replace("function Em(e,t){return !0}", "function Em(e,t){return !1}"),
      changed: true,
    };
  }
  if (source.includes("function Em(e,t){return e&&t}")) {
    return {
      source: source.replace("function Em(e,t){return e&&t}", "function Em(e,t){return !1}"),
      changed: true,
    };
  }
  return { source, changed: false };
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

    const ideContextHidden = ensureIdeContextHidden(source);
    source = ideContextHidden.source;
    changed = changed || ideContextHidden.changed;
    if (changed) {
      if (!isCheck) write(file, source);
      touched.push(file);
    }
  }
  return touched;
}
module.exports = { patchComposerBundles };
