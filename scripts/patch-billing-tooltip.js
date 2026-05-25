const { appRootFor, fs, path, read, write } = require("./patch-util");

const OLD_BILLING_FALLBACK = "\\u4eca\\u65e5\\u6d88\\u8d39 -- \\u00b7 \\u5269\\u4f59\\u91d1\\u989d --";
const OLD_SHORT_BILLING_FALLBACK = "\\u4eca\\u65e5 -- \\u00b7 \\u4f59\\u989d --";
const BILLING_FALLBACK = "\\u4eca -- \\u00b7 \\u4f59 --";

function patchBillingTooltipBundles(platform, isCheck) {
  return [
    ...removeComposerCompactBilling(platform, isCheck),
    ...patchNativeContextTooltip(platform, isCheck),
  ];
}

function removeFunction(source, name, nextName) {
  const start = source.indexOf(`function ${name}()`);
  if (start < 0) return source;
  const next = source.indexOf(`function ${nextName}`, start + 1);
  if (next < 0) return source;
  return source.slice(0, start) + source.slice(next);
}

function removeComposerCompactBilling(platform, isCheck) {
  const root = appRootFor(platform);
  const assetsDir = path.join(root, "webview", "assets");
  if (!fs.existsSync(assetsDir)) return [];
  const touched = [];

  for (const name of fs.readdirSync(assetsDir)) {
    if (!/^composer-(?!atoms-).*\.js$/.test(name)) continue;
    const file = path.join(assetsDir, name);
    let source = read(file);
    const original = source;

    source = removeFunction(source, "ChainCloudBillingTooltipLine", "Rh");
    source = source.replace(
      "let l=(0,Q.jsxs)(Q.Fragment,{children:[c,(0,Q.jsx)(ChainCloudBillingTooltipLine,{})]}),u;",
      "let l=c,u;",
    );

    const rhStart = source.indexOf("function Rh(e){");
    const rhEnd = rhStart >= 0 ? source.indexOf("function zh(e)", rhStart) : -1;
    const rhBody = rhEnd > rhStart ? source.slice(rhStart, rhEnd) : "";
    if (rhBody.includes("ChainCloudBillingTooltipLine")) {
      throw new Error("Failed to remove ChainCloud billing from /compact command");
    }

    if (source !== original) {
      if (!isCheck) write(file, source);
      touched.push(file);
    }
  }
  return touched;
}

function patchNativeContextTooltip(platform, isCheck) {
  const root = appRootFor(platform);
  const assetsDir = path.join(root, "webview", "assets");
  if (!fs.existsSync(assetsDir)) return [];
  const touched = [];

  for (const name of fs.readdirSync(assetsDir)) {
    if (!/^local-conversation-thread-.*\.js$/.test(name)) continue;
    const file = path.join(assetsDir, name);
    let source = read(file);
    const original = source;

    if (source.includes(OLD_BILLING_FALLBACK)) {
      source = source.replaceAll(OLD_BILLING_FALLBACK, BILLING_FALLBACK);
    }
    if (source.includes(OLD_SHORT_BILLING_FALLBACK)) {
      source = source.replaceAll(OLD_SHORT_BILLING_FALLBACK, BILLING_FALLBACK);
    }

    if (!source.includes("function ChainCloudContextBillingTooltip()")) {
      const marker = "function mu(e){";
      const helper =
        `function ChainCloudContextBillingTooltip(){let[e,t]=(0,Z.useState)(window.__chaincloudCodexAuth?.billingPopoverText?.()||\`${BILLING_FALLBACK}\`);return(0,Z.useEffect)(()=>{let e=!0,n=()=>{e&&t(window.__chaincloudCodexAuth?.billingPopoverText?.()||\`${BILLING_FALLBACK}\`)};n(),window.__chaincloudCodexAuth?.refreshBillingSummary?.(!0).then(n).catch(n);let r=()=>n();return window.addEventListener(\`chaincloud-billing-updated\`,r),window.addEventListener(\`chaincloud-auth-changed\`,r),()=>{e=!1,window.removeEventListener(\`chaincloud-billing-updated\`,r),window.removeEventListener(\`chaincloud-auth-changed\`,r)}},[]),(0,$.jsx)(\`div\`,{className:\`mt-1 border-t border-token-border/60 pt-1 text-center text-token-foreground\`,children:e})}`;
      if (!source.includes(marker)) throw new Error("Unable to locate native context status component");
      source = source.replace(marker, helper + marker);
    }

    const staleFake =
      "D=(0,$.jsx)(Tn,{side:`left`,tooltipContent:p?(0,$.jsxs)($.Fragment,{children:[p,(0,$.jsx)(ChainCloudContextBilling,{})]}):(0,$.jsx)(ChainCloudContextBilling,{}),children:E})";
    const nativeTooltip = "D=(0,$.jsx)(Tn,{side:`left`,tooltipContent:p,children:E})";
    const patchedTooltip =
      "D=(0,$.jsx)(Tn,{side:`left`,tooltipContent:p?(0,$.jsxs)($.Fragment,{children:[p,(0,$.jsx)(ChainCloudContextBillingTooltip,{})]}):(0,$.jsx)(ChainCloudContextBillingTooltip,{}),children:E})";
    if (source.includes(staleFake)) source = source.replace(staleFake, nativeTooltip);
    if (source.includes(nativeTooltip)) source = source.replace(nativeTooltip, patchedTooltip);

    const muStart = source.indexOf("function mu(e){");
    const muEnd = muStart >= 0 ? source.indexOf("function hu(", muStart) : -1;
    const muBody = muEnd > muStart ? source.slice(muStart, muEnd) : "";
    if (!source.includes("function ChainCloudContextBillingTooltip()") || !muBody.includes("ChainCloudContextBillingTooltip")) {
      throw new Error("Failed to verify ChainCloud billing on native context tooltip");
    }

    if (source !== original) {
      if (!isCheck) write(file, source);
      touched.push(file);
    }
  }
  return touched;
}

module.exports = { patchBillingTooltipBundles };
