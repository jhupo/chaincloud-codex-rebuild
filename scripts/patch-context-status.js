#!/usr/bin/env node
/**
 * Keep context usage available without exposing the upstream status overlay entry
 * that crashes in the patched desktop bundle.
 */
const { appRootFor, fs, path, read, relPath, write } = require("./patch-util");
const { platformsFor } = require("./chaincloud-auth/platforms");

function replaceBetween(source, startNeedle, endNeedle, replacement) {
  const start = source.indexOf(startNeedle);
  if (start < 0) return { source, changed: false };
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  if (end < 0) throw new Error(`Unable to locate end marker ${endNeedle}`);
  return {
    source: source.slice(0, start) + replacement + source.slice(end),
    changed: true,
  };
}

function ensureComposerFooterContextStatus(source) {
  source = source.replaceAll("`aria-label`:s", '"aria-label":s');
  if (source.includes("function ChainCloudComposerContextStatus(")) return source;

  const marker = "function Um(e){";
  if (!source.includes(marker)) return source;

  const helper =
    "function ChainCloudComposerContextBilling(){let[e,t]=(0,Z.useState)(window.__chaincloudCodexAuth?.billingPopoverText?.()||`\\u4eca\\u65e5 -- \\u00b7 \\u4f59\\u989d --`);return(0,Z.useEffect)(()=>{let e=!0,n=()=>{e&&t(window.__chaincloudCodexAuth?.billingPopoverText?.()||`\\u4eca\\u65e5 -- \\u00b7 \\u4f59\\u989d --`)};n(),window.__chaincloudCodexAuth?.refreshBillingSummary?.(!0).then(n).catch(n);let r=()=>n();return window.addEventListener(`chaincloud-billing-updated`,r),window.addEventListener(`chaincloud-auth-changed`,r),()=>{e=!1,window.removeEventListener(`chaincloud-billing-updated`,r),window.removeEventListener(`chaincloud-auth-changed`,r)}},[]),(0,Q.jsx)(`div`,{className:`mt-1 border-t border-token-border/60 pt-1 text-center text-token-foreground`,children:e})}function ChainCloudComposerContextStatus(e){let t=(0,$.c)(20),{conversationId:n}=e,r=kt(),i=Et(E,n),a,o,s;if(t[0]!==i||t[1]!==r){let{percent:e,usedTokens:n,contextWindow:c}=jc(i);a=e??0,o=e==null?`\\u4e0a\\u4e0b\\u6587\\u7528\\u91cf\\u6682\\u4e0d\\u53ef\\u7528`:r.formatMessage({id:`codex.localConversation.status.contextUsageTooltip`,defaultMessage:`{usedTokens, number} / {contextWindow, number} tokens used`,description:`Tooltip showing used context tokens and total context window size in the composer footer`,values:{contextWindow:c,usedTokens:n}}),s=e==null?r.formatMessage({id:`codex.localConversation.status.contextUnavailableAriaLabel`,defaultMessage:`Context usage unavailable`,description:`Accessible label for the context usage donut when token usage is not available`}):r.formatMessage({id:`codex.localConversation.status.contextAriaLabel`,defaultMessage:`Context usage: {percent}%`,description:`Accessible label for the context usage donut in the composer footer`},{percent:r.formatNumber(e,{maximumFractionDigits:0})}),t[0]=i,t[1]=r,t[2]=a,t[3]=o,t[4]=s}else a=t[2],o=t[3],s=t[4];let c;t[5]===a?c=t[6]:(c=(0,Q.jsx)(Lh,{percent:a,className:`icon-2xs text-token-foreground`}),t[5]=a,t[6]=c);let l;t[7]!==s||t[8]!==c?(l=(0,Q.jsx)(`span`,{className:`inline-flex size-5 items-center justify-center`,role:`img`,\"aria-label\":s,children:c}),t[7]=s,t[8]=c,t[9]=l):l=t[9];let u;t[10]!==o||t[11]!==l?(u=(0,Q.jsx)(Dn,{tooltipContent:(0,Q.jsxs)(Q.Fragment,{children:[o,(0,Q.jsx)(ChainCloudComposerContextBilling,{})]}),side:`top`,align:`center`,sideOffset:4,children:l}),t[10]=o,t[11]=l,t[12]=u):u=t[12];return u}";

  return source.replace(marker, helper + marker);
}

function patchContextStatusBundles(platform, isCheck) {
  const assetsDir = path.join(appRootFor(platform), "webview", "assets");
  const files = fs
    .readdirSync(assetsDir)
    .filter((file) => /^composer-(?!atoms-).*\.js$/.test(file));

  const touched = [];
  for (const file of files) {
    const bundle = path.join(assetsDir, file);
    const original = read(bundle);
    let source = original;

    source = source.replace(
      /([A-Za-z_$][\w$]*)=B\(`local-conversation-status-section-visible`,!1\)/g,
      "$1=B(`local-conversation-status-section-visible`,!0)",
    );

    if (source.includes("function Qg(){") && !source.includes("function Qg(){return null}")) {
      const replaced = replaceBetween(source, "function Qg(){", "function $g(", "function Qg(){return null}");
      source = replaced.source;
    }

    source = ensureComposerFooterContextStatus(source);

    const footerNeedle = "children:[P,F,r,I]";
    if (source.includes(footerNeedle)) {
      source = source.replace(footerNeedle, "children:[(0,Q.jsx)(ChainCloudComposerContextStatus,{conversationId:i}),P,F,r,I]");
    }

    if (
      source.includes("local-conversation-status-section-visible") &&
      !/[A-Za-z_$][\w$]*=B\(`local-conversation-status-section-visible`,!0\)/.test(source)
    ) {
      throw new Error(`Unable to patch context status visibility in ${relPath(bundle)}`);
    }
    if (original.includes("function Qg(){") && !source.includes("function Qg(){return null}")) {
      throw new Error(`Unable to disable crashing status command in ${relPath(bundle)}`);
    }
    if (original.includes("function Um(e){") && !source.includes("ChainCloudComposerContextStatus,{conversationId:i}")) {
      throw new Error(`Unable to mount composer context status in ${relPath(bundle)}`);
    }

    if (source !== original) {
      touched.push(bundle);
      if (!isCheck) write(bundle, source);
    }
  }

  if (touched.length === 0) {
    console.log(`  [=] ${platform}: context status already visible`);
  } else if (isCheck) {
    console.log(`  [check] ${platform}: context status visibility needs patch`);
  } else {
    for (const file of touched) console.log(`  [ok] ${relPath(file)}`);
  }

  return touched.length;
}

function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const argPlatform = args.find((arg) =>
    ["mac-arm64", "mac-x64", "win", "preview-win"].includes(arg),
  );

  const platforms = platformsFor(argPlatform);
  if (platforms.length === 0) {
    console.log("[!] no platform bundles found");
    return;
  }

  let changed = 0;
  for (const platform of platforms) changed += patchContextStatusBundles(platform, isCheck);

  if (isCheck && changed > 0) process.exit(1);
}

if (require.main === module) main();

module.exports = { patchContextStatusBundles };
