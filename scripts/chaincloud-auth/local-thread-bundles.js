const { appRootFor, fs, path, read, write } = require("../patch-util");

function patchLocalThreadBundles(platform, isCheck) {
  const root = appRootFor(platform);
  const assetsDir = path.join(root, "webview", "assets");
  if (!fs.existsSync(assetsDir)) return [];
  const touched = [];
  for (const name of fs.readdirSync(assetsDir)) {
    if (!/^local-conversation-thread-.*\.js$/.test(name)) continue;
    const file = path.join(assetsDir, name);
    let source = read(file);
    const original = source;
    let changed = false;

    if (source.includes("function ChainCloudContextBilling()")) {
      const helperStart = source.indexOf("function ChainCloudContextBilling()");
      const helperEnd = helperStart >= 0 ? source.indexOf("function mu(e)", helperStart) : -1;
      if (helperStart >= 0 && helperEnd > helperStart) {
        source = source.slice(0, helperStart) + source.slice(helperEnd);
        changed = true;
      }
    }

    const tooltipNeedle = "D=(0,$.jsx)(Tn,{side:`left`,tooltipContent:p,children:E})";
    const fakeTooltip =
      "D=(0,$.jsx)(Tn,{side:`left`,tooltipContent:p?(0,$.jsxs)($.Fragment,{children:[p,(0,$.jsx)(ChainCloudContextBilling,{})]}):(0,$.jsx)(ChainCloudContextBilling,{}),children:E})";
    if (source.includes(fakeTooltip)) {
      source = source.replace(fakeTooltip, tooltipNeedle);
      changed = true;
    }

    const billingApiKeyRow = /else if\(x\)\{let e,n=window\.__chaincloudCodexAuth\?\.displayName\?\.\(\)\|\|``,r=window\.__chaincloudCodexAuth\?\.billingText\?\.\(\)\|\|``;n&&\(e=\(0,Q\.jsxs\)\(Q\.Fragment,\{children:\[\(0,Q\.jsx\)\(jo,\{LeftIcon:Yu,disabled:!0,children:n\},`chaincloud-auth`\),r\?\(0,Q\.jsx\)\(jo,\{disabled:!0,children:r\},`chaincloud-billing`\):null\]\}\),De\.push\(e\)\)\}/;
    if (billingApiKeyRow.test(source)) {
      source = source.replace(
        billingApiKeyRow,
        "else if(x){let e,n=window.__chaincloudCodexAuth?.displayName?.()||``;n&&(e=(0,Q.jsx)(jo,{LeftIcon:Yu,disabled:!0,children:n},`chaincloud-auth`),De.push(e))}",
      );
      changed = true;
    }

    const loginRow = /Be=\(window\.__chaincloudCodexAuth\?\.isLoggedIn\?\.\(\)\?f:!0\)&&\(0,Q\.jsx\)\(jo,\{onClick:\(\)=>\{o\(!1\),window\.__chaincloudCodexAuth\?\.isLoggedIn\?\.\(\)\?Ha\(r,rd,\{onConfirm:we\}\):window\.__chaincloudCodexAuth\?\.showLoginModal\?\.\(\{onSuccess:async\(\{key:e\}\)=>\{await zt\(`login-with-api-key`,\{hostId:Wr,apiKey:e\.key\}\),h\(`apikey`\)\}\}\)\},LeftIcon:Qs,children:window\.__chaincloudCodexAuth\?\.isLoggedIn\?\.\(\)\?\(0,Q\.jsx\)\(X,\{id:`codex\.profileDropdown\.logOut`,defaultMessage:`Log out`,description:`Menu item to log out of ChatGPT`\}\):`[^`]*`\},`chaincloud-login-profile`\)/;
    if (loginRow.test(source) && !source.includes("chaincloud-recharge-profile")) {
      source = source.replace(
        loginRow,
        "Be=(0,Q.jsxs)(Q.Fragment,{children:[window.__chaincloudCodexAuth?.isLoggedIn?.()?(0,Q.jsx)(jo,{onClick:()=>{o(!1),window.__chaincloudCodexAuth?.showRechargeDialog?.()},LeftIcon:Xu,children:`\u5145\u503c`},`chaincloud-recharge-profile`):null,(window.__chaincloudCodexAuth?.isLoggedIn?.()?f:!0)&&(0,Q.jsx)(jo,{onClick:()=>{o(!1),window.__chaincloudCodexAuth?.isLoggedIn?.()?Ha(r,rd,{onConfirm:we}):window.__chaincloudCodexAuth?.showLoginModal?.({onSuccess:async({key:e})=>{await zt(`login-with-api-key`,{hostId:Wr,apiKey:e.key}),h(`apikey`)}})},LeftIcon:Qs,children:window.__chaincloudCodexAuth?.isLoggedIn?.()?(0,Q.jsx)(X,{id:`codex.profileDropdown.logOut`,defaultMessage:`Log out`,description:`Menu item to log out of ChatGPT`}):`\u767b\u5f55`},`chaincloud-login-profile`)]})",
      );
      changed = true;
    }

    changed = changed && source !== original;
    if (changed) {
      if (!isCheck) write(file, source);
      touched.push(file);
    }
  }
  return touched;
}
module.exports = { patchLocalThreadBundles };
