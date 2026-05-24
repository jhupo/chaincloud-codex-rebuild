const { appRootFor, fs, path, read, write } = require("./patch-util");

function patchBillingTooltipBundles(platform, isCheck) {
  return [
    ...patchComposerCompactTooltip(platform, isCheck),
    ...patchLocalConversationTooltip(platform, isCheck),
  ];
}

function patchComposerCompactTooltip(platform, isCheck) {
  const root = appRootFor(platform);
  const assetsDir = path.join(root, "webview", "assets");
  if (!fs.existsSync(assetsDir)) return [];
  const touched = [];
  for (const name of fs.readdirSync(assetsDir)) {
    if (!/^composer-(?!atoms-).*\.js$/.test(name)) continue;
    const file = path.join(assetsDir, name);
    let source = read(file);
    const original = source;

    if (!source.includes("function ChainCloudBillingTooltipLine()")) {
      const marker = "function Rh(e){";
      const helper =
        "function ChainCloudBillingTooltipLine(){let[e,t]=(0,Z.useState)(window.__chaincloudCodexAuth?.billingPopoverText?.()||`浠婃棩娑堣垂 -- 路 鍓╀綑閲戦 --`);return(0,Z.useEffect)(()=>{let e=!0,n=()=>{e&&t(window.__chaincloudCodexAuth?.billingPopoverText?.()||`浠婃棩娑堣垂 -- 路 鍓╀綑閲戦 --`)};n(),window.__chaincloudCodexAuth?.refreshBillingSummary?.(!0).then(n).catch(n);let r=()=>n();return window.addEventListener(`chaincloud-billing-updated`,r),window.addEventListener(`chaincloud-auth-changed`,r),()=>{e=!1,window.removeEventListener(`chaincloud-billing-updated`,r),window.removeEventListener(`chaincloud-auth-changed`,r)}},[]),(0,Q.jsx)(`div`,{className:`mt-1 border-t border-token-border/60 pt-1 text-center text-token-foreground`,children:e})}";
      if (source.includes(marker)) source = source.replace(marker, helper + marker);
    }

    const wrongGlobalPatch =
      "let l=(0,Q.jsxs)(Q.Fragment,{children:[c,(0,Q.jsx)(ChainCloudBillingTooltipLine,{})]}),u;t[2]!==i||t[3]!==r?";
    if (source.includes(wrongGlobalPatch)) {
      source = source.replace(wrongGlobalPatch, "let l=c,u;t[2]!==i||t[3]!==r?");
    }

    const descriptionNeedle = "let l=c,u;";
    const descriptionReplacement =
      "let l=(0,Q.jsxs)(Q.Fragment,{children:[c,(0,Q.jsx)(ChainCloudBillingTooltipLine,{})]}),u;";
    const rhStart = source.indexOf("function Rh(e){");
    const rhEnd = rhStart >= 0 ? source.indexOf("function zh(e)", rhStart) : -1;
    if (rhStart >= 0 && rhEnd > rhStart) {
      const before = source.slice(0, rhStart);
      let body = source.slice(rhStart, rhEnd);
      const after = source.slice(rhEnd);
      if (!body.includes(descriptionReplacement) && body.includes(descriptionNeedle)) {
        body = body.replace(descriptionNeedle, descriptionReplacement);
        source = before + body + after;
      }
    }

    const rhPatched = "function Rh(e){";
    if (source !== original) {
      const rhStartAfter = source.indexOf(rhPatched);
      const rhEndAfter = rhStartAfter >= 0 ? source.indexOf("function zh(e)", rhStartAfter) : -1;
      const rhBodyAfter = rhEndAfter > rhStartAfter ? source.slice(rhStartAfter, rhEndAfter) : "";
      if (!rhBodyAfter.includes(descriptionReplacement)) {
        throw new Error("Failed to verify ChainCloud composer billing tooltip patch");
      }
      if (!isCheck) write(file, source);
      touched.push(file);
    }
  }
  return touched;
}

function patchLocalConversationTooltip(platform, isCheck) {
  const root = appRootFor(platform);
  const assetsDir = path.join(root, "webview", "assets");
  if (!fs.existsSync(assetsDir)) return [];
  const touched = [];
  for (const name of fs.readdirSync(assetsDir)) {
    if (!/^local-conversation-thread-.*\.js$/.test(name)) continue;
    const file = path.join(assetsDir, name);
    let source = read(file);
    const original = source;

    if (!source.includes("function ChainCloudContextBillingTooltip()")) {
      const marker = "function mu(e){";
      const helper =
        "function ChainCloudContextBillingTooltip(){let[e,t]=(0,Z.useState)(window.__chaincloudCodexAuth?.billingPopoverText?.()||`浠婃棩娑堣垂 -- 路 鍓╀綑閲戦 --`);return(0,Z.useEffect)(()=>{let e=!0,n=()=>{e&&t(window.__chaincloudCodexAuth?.billingPopoverText?.()||`浠婃棩娑堣垂 -- 路 鍓╀綑閲戦 --`)};n(),window.__chaincloudCodexAuth?.refreshBillingSummary?.(!0).then(n).catch(n);let r=()=>n();return window.addEventListener(`chaincloud-billing-updated`,r),window.addEventListener(`chaincloud-auth-changed`,r),()=>{e=!1,window.removeEventListener(`chaincloud-billing-updated`,r),window.removeEventListener(`chaincloud-auth-changed`,r)}},[]),(0,$.jsx)(`div`,{className:`mt-1 border-t border-token-border/60 pt-1 text-center text-token-foreground`,children:e})}";
      if (source.includes(marker)) source = source.replace(marker, helper + marker);
    }

    const tooltipNeedle = "D=(0,$.jsx)(Tn,{side:`left`,tooltipContent:p,children:E})";
    const tooltipReplacement =
      "D=(0,$.jsx)(Tn,{side:`left`,tooltipContent:p?(0,$.jsxs)($.Fragment,{children:[p,(0,$.jsx)(ChainCloudContextBillingTooltip,{})]}):(0,$.jsx)(ChainCloudContextBillingTooltip,{}),children:E})";
    if (source.includes(tooltipNeedle)) {
      source = source.replace(tooltipNeedle, tooltipReplacement);
    }

    if (source !== original) {
      if (!source.includes("ChainCloudContextBillingTooltip")) {
        throw new Error("Failed to verify ChainCloud local billing tooltip patch");
      }
      if (!isCheck) write(file, source);
      touched.push(file);
    }
  }
  return touched;
}

module.exports = { patchBillingTooltipBundles };
