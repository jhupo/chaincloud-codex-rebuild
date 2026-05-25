const { appRootFor, fs, path, read, write } = require("../patch-util");

function patchProfileBundleFile(file, isCheck) {
  let source = read(file);
  const original = source;
  let changed = false;
  if (!source.includes("codex.profileDropdown.apiKeyAuth") && !source.includes("chaincloud-auth")) return false;

  const originalApiKeyRow = /else if\(x\)\{let e;t\[87\]===Symbol\.for\(`react\.memo_cache_sentinel`\)\?\(e=\(0,Q\.jsx\)\(jo,\{LeftIcon:Yu,disabled:!0,children:\(0,Q\.jsx\)\(X,\{id:`codex\.profileDropdown\.apiKeyAuth`,defaultMessage:`Logged in with API key`,description:`Label indicating the user is authenticated with an API key`\}\)\},`api-key-auth`\),t\[87\]=e\):e=t\[87\],De\.push\(e\)\}/;
  if (originalApiKeyRow.test(source)) {
    source = source.replace(
      originalApiKeyRow,
      "else if(x){let e,n=window.__chaincloudCodexAuth?.displayName?.()||``;n&&(e=(0,Q.jsx)(jo,{LeftIcon:Yu,disabled:!0,children:n},`chaincloud-auth`),De.push(e))}",
    );
    changed = true;
  }

  const oldChaincloudApiKeyRow = /else if\(x\)\{let e,n=window\.__chaincloudCodexAuth\?\.displayName\?\.\(\)\|\|``;n&&\(e=\(0,Q\.jsx\)\(jo,\{LeftIcon:Yu,disabled:!0,children:n\},`chaincloud-auth`\),De\.push\(e\)\)\}/;
  if (oldChaincloudApiKeyRow.test(source)) {
    source = source.replace(
      oldChaincloudApiKeyRow,
      "else if(x){let e,n=window.__chaincloudCodexAuth?.displayName?.()||``;n&&(e=(0,Q.jsx)(jo,{LeftIcon:Yu,disabled:!0,children:n},`chaincloud-auth`),De.push(e))}",
    );
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

  const profileDropdownApiKeyRow = /else if\(D\)\{let e;t\[87\]===Symbol\.for\(`react\.memo_cache_sentinel`\)\?\(e=\(0,Z\.jsx\)\(K,\{LeftIcon:Qe,disabled:!0,children:\(0,Z\.jsx\)\(C,\{id:`codex\.profileDropdown\.apiKeyAuth`,defaultMessage:`Logged in with API key`,description:`Label indicating the user is authenticated with an API key`\}\)\},`api-key-auth`\),t\[87\]=e\):e=t\[87\],Q\.push\(e\)\}/;
  if (profileDropdownApiKeyRow.test(source)) {
    source = source.replace(
      profileDropdownApiKeyRow,
      "else if(D){let e,n=window.__chaincloudCodexAuth?.displayName?.()||``;n&&(e=(0,Z.jsx)(K,{LeftIcon:Qe,disabled:!0,children:n},`chaincloud-auth`),Q.push(e))}",
    );
    changed = true;
  }

  const logoutFn = /Ce=async\(\)=>\{await vi\(r,`use-copilot-auth-if-available`,!1\),await zt\(`logout`,\{hostId:Wr\}\),s\(`\/login`\)\}/;
  if (logoutFn.test(source) && !source.includes("chaincloudCodexAuth?.logout")) {
    source = source.replace(
      logoutFn,
      "Ce=async()=>{await window.__chaincloudCodexAuth?.logout?.(),await vi(r,`use-copilot-auth-if-available`,!1),await zt(`logout`,{hostId:Wr})}",
    );
    changed = true;
  }
  const oldChaincloudLogoutFn = /Ce=async\(\)=>\{await window\.__chaincloudCodexAuth\?\.logout\?\.\(\),await vi\(r,`use-copilot-auth-if-available`,!1\),await zt\(`logout`,\{hostId:Wr\}\),s\(`\/login`\)\}/;
  if (oldChaincloudLogoutFn.test(source)) {
    source = source.replace(
      oldChaincloudLogoutFn,
      "Ce=async()=>{await window.__chaincloudCodexAuth?.logout?.(),await vi(r,`use-copilot-auth-if-available`,!1),await zt(`logout`,{hostId:Wr})}",
    );
    changed = true;
  }

  const profileDropdownLogoutFn = /bt=async\(\)=>\{await o\(i,`use-copilot-auth-if-available`,!1\),await _\(`logout`,\{hostId:f\}\),u\(`\/login`\)\}/;
  if (profileDropdownLogoutFn.test(source) && !source.includes("bt=async()=>{await window.__chaincloudCodexAuth?.logout")) {
    source = source.replace(
      profileDropdownLogoutFn,
      "bt=async()=>{await window.__chaincloudCodexAuth?.logout?.(),await o(i,`use-copilot-auth-if-available`,!1),await _(`logout`,{hostId:f})}",
    );
    changed = true;
  }

  const logoutRow = /Be=f&&\(0,Q\.jsx\)\(jo,\{onClick:\(\)=>\{o\(!1\),Ha\(r,rd,\{onConfirm:we\}\)\},LeftIcon:Qs,children:\(0,Q\.jsx\)\(X,\{id:`codex\.profileDropdown\.logOut`,defaultMessage:`Log out`,description:`Menu item to log out of ChatGPT`\}\)\}\)/;
  if (logoutRow.test(source) && !source.includes("chaincloud-login-profile")) {
    source = source.replace(
      logoutRow,
      "Be=(window.__chaincloudCodexAuth?.isLoggedIn?.()?f:!0)&&(0,Q.jsx)(jo,{onClick:()=>{o(!1),window.__chaincloudCodexAuth?.isLoggedIn?.()?Ha(r,rd,{onConfirm:we}):window.__chaincloudCodexAuth?.showLoginModal?.({onSuccess:async({key:e})=>{await window.__chaincloudCodexSwitchApiKey?.(e.key)}})},LeftIcon:Qs,children:window.__chaincloudCodexAuth?.isLoggedIn?.()?(0,Q.jsx)(X,{id:`codex.profileDropdown.logOut`,defaultMessage:`Log out`,description:`Menu item to log out of ChatGPT`}):`\u767b\u5f55`},`chaincloud-login-profile`)",
    );
    changed = true;
  }

  const loginRow = /Be=\(window\.__chaincloudCodexAuth\?\.isLoggedIn\?\.\(\)\?f:!0\)&&\(0,Q\.jsx\)\(jo,\{onClick:\(\)=>\{o\(!1\),window\.__chaincloudCodexAuth\?\.isLoggedIn\?\.\(\)\?Ha\(r,rd,\{onConfirm:we\}\):window\.__chaincloudCodexAuth\?\.showLoginModal\?\.\(\{onSuccess:async\(\{key:e\}\)=>\{await zt\(`login-with-api-key`,\{hostId:Wr,apiKey:e\.key\}\),h\(`apikey`\)\}\}\)\},LeftIcon:Qs,children:window\.__chaincloudCodexAuth\?\.isLoggedIn\?\.\(\)\?\(0,Q\.jsx\)\(X,\{id:`codex\.profileDropdown\.logOut`,defaultMessage:`Log out`,description:`Menu item to log out of ChatGPT`\}\):`[^`]*`\},`chaincloud-login-profile`\)/;
  if (loginRow.test(source) && !source.includes("chaincloud-recharge-profile")) {
    source = source.replace(
      loginRow,
        "Be=(0,Q.jsxs)(Q.Fragment,{children:[window.__chaincloudCodexAuth?.isLoggedIn?.()?(0,Q.jsx)(jo,{onClick:()=>{o(!1),window.__chaincloudCodexAuth?.showRechargeDialog?.()},LeftIcon:Xu,children:`\u5145\u503c`},`chaincloud-recharge-profile`):null,(0,Q.jsx)(jo,{onClick:()=>{o(!1),s(`/settings/general-settings`)},LeftIcon:Xu,children:`\u8bbe\u7f6e`},`chaincloud-settings-profile`),(window.__chaincloudCodexAuth?.isLoggedIn?.()?f:!0)&&(0,Q.jsx)(jo,{onClick:()=>{o(!1),window.__chaincloudCodexAuth?.isLoggedIn?.()?Ha(r,rd,{onConfirm:we}):window.__chaincloudCodexAuth?.showLoginModal?.({onSuccess:async({key:e})=>{await window.__chaincloudCodexSwitchApiKey?.(e.key)}})},LeftIcon:Qs,children:window.__chaincloudCodexAuth?.isLoggedIn?.()?(0,Q.jsx)(X,{id:`codex.profileDropdown.logOut`,defaultMessage:`Log out`,description:`Menu item to log out of ChatGPT`}):`\u767b\u5f55`},`chaincloud-login-profile`)]})",
    );
    changed = true;
  }

  const signInOpenAiRow = /if\(ve\)\{let e;t\[105\]!==u\|\|t\[106\]!==c\?\(e=\(\)=>\{c\(!1\),u\(`\/login`\)\},t\[105\]=u,t\[106\]=c,t\[107\]=e\):e=t\[107\];let n;t\[108\]===Symbol\.for\(`react\.memo_cache_sentinel`\)\?\(n=\(0,Z\.jsx\)\(C,\{id:`codex\.profileDropdown\.signInWithOpenAI`,defaultMessage:`Sign in with ChatGPT`,description:`Profile menu item to sign in with ChatGPT`\}\),t\[108\]=n\):n=t\[108\];let r;t\[109\]===e\?r=t\[110\]:\(r=\(0,Z\.jsx\)\(K,\{onClick:e,LeftIcon:Ge,children:n\},`sign-in-openai`\),t\[109\]=e,t\[110\]=r\),Q\.push\(r\)\}/;
  if (signInOpenAiRow.test(source) && !source.includes("chaincloud-login-profile")) {
    source = source.replace(
      signInOpenAiRow,
      "if(ve){let e;t[105]!==c||t[106]!==f||t[107]!==y?(e=()=>{c(!1),window.__chaincloudCodexAuth?.showLoginModal?.({onSuccess:async({key:e})=>{await window.__chaincloudCodexSwitchApiKey?.(e.key)}})},t[105]=c,t[106]=f,t[107]=y,t[108]=e):e=t[108];let r;t[109]===e?r=t[110]:(r=(0,Z.jsx)(K,{onClick:e,LeftIcon:Ge,children:`\u767b\u5f55`},`chaincloud-login-profile`),t[109]=e,t[110]=r),Q.push(r)}",
    );
    changed = true;
  }

  const profileSwitcher =
    "window.__chaincloudCodexSwitchApiKey=async e=>{let t=window.__chaincloudCodexAuth;await _(`login-with-api-key`,{hostId:f,apiKey:e}),await t?.applyCodexConfig?.(e=>_(`batch-write-config-value`,{hostId:f,...e})),y(`apikey`)};";
  const legacySwitcher =
    "window.__chaincloudCodexSwitchApiKey=async e=>{let t=window.__chaincloudCodexAuth;await zt(`login-with-api-key`,{hostId:Wr,apiKey:e}),await t?.applyCodexConfig?.(e=>zt(`batch-write-config-value`,{hostId:Wr,...e})),h(`apikey`)};";
  const oldProfileSwitcher =
    "window.__chaincloudCodexSwitchApiKey=async e=>{await _(`login-with-api-key`,{hostId:f,apiKey:e}),y(`apikey`)};";
  const oldLegacySwitcher =
    "window.__chaincloudCodexSwitchApiKey=async e=>{await zt(`login-with-api-key`,{hostId:Wr,apiKey:e}),h(`apikey`)};";
  if (source.includes(oldProfileSwitcher)) {
    source = source.replace(oldProfileSwitcher, profileSwitcher);
    changed = true;
  }
  if (source.includes(oldLegacySwitcher)) {
    source = source.replace(oldLegacySwitcher, legacySwitcher);
    changed = true;
  }
  const oldProfileLoginSuccess =
    "onSuccess:async({key:e})=>{await _(`login-with-api-key`,{hostId:f,apiKey:e.key}),y(`apikey`)}";
  if (source.includes(oldProfileLoginSuccess)) {
    source = source.replaceAll(
      oldProfileLoginSuccess,
      "onSuccess:async({key:e})=>{await window.__chaincloudCodexSwitchApiKey?.(e.key)}",
    );
    changed = true;
  }
  const oldLegacyLoginSuccess =
    "onSuccess:async({key:e})=>{await zt(`login-with-api-key`,{hostId:Wr,apiKey:e.key}),h(`apikey`)}";
  if (source.includes(oldLegacyLoginSuccess)) {
    source = source.replaceAll(
      oldLegacyLoginSuccess,
      "onSuccess:async({key:e})=>{await window.__chaincloudCodexSwitchApiKey?.(e.key)}",
    );
    changed = true;
  }

  if (source.includes("chaincloud-login-profile") && !source.includes("__chaincloudCodexSwitchApiKey")) {
    const profileDropdownSwitcherNeedle = "if(ve){let e;t[105]!==c||t[106]!==f||t[107]!==y?";
    if (source.includes(profileDropdownSwitcherNeedle)) {
      source = source.replace(
        profileDropdownSwitcherNeedle,
        profileSwitcher + profileDropdownSwitcherNeedle,
      );
      changed = true;
    }
    const legacyDropdownSwitcherNeedle = "Be=(0,Q.jsxs)(Q.Fragment,{children:[window.__chaincloudCodexAuth?.isLoggedIn?.()?";
    if (source.includes(legacyDropdownSwitcherNeedle)) {
      source = source.replace(
        legacyDropdownSwitcherNeedle,
        legacySwitcher + legacyDropdownSwitcherNeedle,
      );
      changed = true;
    }
  }

  if (source.includes("profile-dropdown") && !source.includes("chaincloud-recharge-profile")) {
    const rechargeNeedle = "let Ft;t[147]!==xt||t[148]!==g||t[149]!==i||t[150]!==c?(Ft=g&&(0,Z.jsx)(K,{onClick:()=>{c(!1),be(i,Jt,{onConfirm:xt})},LeftIcon:Ze,children:(0,Z.jsx)(C,{id:`codex.profileDropdown.logOut`,defaultMessage:`Log out`,description:`Menu item to log out of ChatGPT`})}),t[147]=xt,t[148]=g,t[149]=i,t[150]=c,t[151]=Ft):Ft=t[151];";
    const rechargeReplacement =
      rechargeNeedle +
      "let Rt=window.__chaincloudCodexAuth?.isLoggedIn?.()?(0,Z.jsx)(K,{LeftIcon:Ue,onClick:()=>{c(!1),window.__chaincloudCodexAuth?.showRechargeDialog?.()},children:`\u5145\u503c`},`chaincloud-recharge-profile`):null,ChainCloudSettingsProfile=(0,Z.jsx)(K,{LeftIcon:Ue,onClick:()=>{c(!1),u(`/settings/general-settings`,{state:q})},children:`\u8bbe\u7f6e`},`chaincloud-settings-profile`);";
    if (source.includes(rechargeNeedle)) {
      source = source.replace(rechargeNeedle, rechargeReplacement);
      source = source.replace(
        "t[157]!==Nt||t[158]!==Pt||t[159]!==Ft?(It=(0,Z.jsxs)(`div`,{className:`flex w-full min-w-0 flex-col gap-0`,children:[Q,$,Et,kt,At,Nt,Pt,Ft]}),t[152]=Q,t[153]=$,t[154]=Et,t[155]=kt,t[156]=At,t[157]=Nt,t[158]=Pt,t[159]=Ft,t[160]=It):It=t[160];",
        "t[157]!==Nt||t[158]!==Pt||t[159]!==Ft||t[166]!==Rt||t[167]!==ChainCloudSettingsProfile?(It=(0,Z.jsxs)(`div`,{className:`flex w-full min-w-0 flex-col gap-0`,children:[Q,$,Et,kt,At,Nt,Pt,Rt,ChainCloudSettingsProfile,Ft]}),t[152]=Q,t[153]=$,t[154]=Et,t[155]=kt,t[156]=At,t[157]=Nt,t[158]=Pt,t[159]=Ft,t[166]=Rt,t[167]=ChainCloudSettingsProfile,t[160]=It):It=t[160];",
      );
      changed = true;
    }
  }

  if (source.includes("profile-dropdown") && source.includes("chaincloud-recharge-profile") && !source.includes("chaincloud-settings-profile")) {
    const rechargeOnly =
      "let Rt=window.__chaincloudCodexAuth?.isLoggedIn?.()?(0,Z.jsx)(K,{LeftIcon:Ue,onClick:()=>{c(!1),window.__chaincloudCodexAuth?.showRechargeDialog?.()},children:`\u5145\u503c`},`chaincloud-recharge-profile`):null;";
    if (source.includes(rechargeOnly)) {
      source = source.replace(
        rechargeOnly,
        rechargeOnly.slice(0, -1) +
          ",ChainCloudSettingsProfile=(0,Z.jsx)(K,{LeftIcon:Ue,onClick:()=>{c(!1),u(`/settings/general-settings`,{state:q})},children:`\u8bbe\u7f6e`},`chaincloud-settings-profile`);",
      );
      source = source.replace(
        "t[157]!==Nt||t[158]!==Pt||t[159]!==Ft||t[166]!==Rt?(It=(0,Z.jsxs)(`div`,{className:`flex w-full min-w-0 flex-col gap-0`,children:[Q,$,Et,kt,At,Nt,Pt,Rt,Ft]}),t[152]=Q,t[153]=$,t[154]=Et,t[155]=kt,t[156]=At,t[157]=Nt,t[158]=Pt,t[159]=Ft,t[166]=Rt,t[160]=It):It=t[160];",
        "t[157]!==Nt||t[158]!==Pt||t[159]!==Ft||t[166]!==Rt||t[167]!==ChainCloudSettingsProfile?(It=(0,Z.jsxs)(`div`,{className:`flex w-full min-w-0 flex-col gap-0`,children:[Q,$,Et,kt,At,Nt,Pt,Rt,ChainCloudSettingsProfile,Ft]}),t[152]=Q,t[153]=$,t[154]=Et,t[155]=kt,t[156]=At,t[157]=Nt,t[158]=Pt,t[159]=Ft,t[166]=Rt,t[167]=ChainCloudSettingsProfile,t[160]=It):It=t[160];",
      );
      changed = true;
    }
  }

  changed = changed && source !== original;
  if (!isCheck && changed) write(file, source);
  return changed;
}

function patchProfileBundles(platform, isCheck) {
  const root = appRootFor(platform);
  const assetsDir = path.join(root, "webview", "assets");
  const touched = [];
  for (const file of fs.readdirSync(assetsDir)) {
    if (!file.endsWith(".js")) continue;
    const full = path.join(assetsDir, file);
    const source = read(full);
    if (!source.includes("codex.profileDropdown.apiKeyAuth") && !source.includes("chaincloud-auth")) continue;
    if (patchProfileBundleFile(full, isCheck)) touched.push(full);
  }
  return touched;
}
module.exports = { patchProfileBundleFile, patchProfileBundles };
