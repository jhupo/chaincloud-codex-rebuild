const { appRootFor, fs, path, read, write } = require("../patch-util");

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
    const providerNeedle = "let t=e.model_provider;if(t==null||t.length===0)return null;";
    if (source.includes(providerNeedle) && !source.includes("t===`openai`)return `\u94fe\u8def\u4e91`")) {
      source = source.replace(
        providerNeedle,
        "let t=e.model_provider;if(t==null||t.length===0)return null;if(t===`openai`)return `\u94fe\u8def\u4e91`;",
      );
      changed = true;
    }
    const providerButtonNeedle = "function Wm(e){let t=(0,$.c)(5),{name:n}=e,r;";
    if (source.includes(providerButtonNeedle) && !source.includes("n=n===`OpenAI`?`\u94fe\u8def\u4e91`:n")) {
      source = source.replace(
        providerButtonNeedle,
        "function Wm(e){let t=(0,$.c)(5),{name:n}=e;n=n===`OpenAI`?`\u94fe\u8def\u4e91`:n;let r;",
      );
      changed = true;
    }

    if (source.includes("function ChainCloudFooterBilling()")) {
      const helperStart = source.indexOf("function ChainCloudFooterBilling()");
      const helperEnd = helperStart >= 0 ? source.indexOf("function Um(e)", helperStart) : -1;
      if (helperStart >= 0 && helperEnd > helperStart) {
        source = source.slice(0, helperStart) + source.slice(helperEnd);
        changed = true;
      }
    }
    if (source.includes("children:[P,(0,Q.jsx)(ChainCloudFooterBilling,{}),F,r,I]")) {
      source = source.replace("children:[P,(0,Q.jsx)(ChainCloudFooterBilling,{}),F,r,I]", "children:[P,F,r,I]");
      changed = true;
    }
    if (changed) {
      if (!isCheck) write(file, source);
      touched.push(file);
    }
  }
  return touched;
}
module.exports = { patchComposerBundles };
