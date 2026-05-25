const { appRootFor, fs, path } = require("../patch-util");

function platformsFor(argPlatform) {
  const all = ["mac-arm64", "mac-x64", "win", "preview-win"];
  const requested = argPlatform === "win" ? ["win", "preview-win"] : argPlatform ? [argPlatform] : all;
  return requested.filter((p) => fs.existsSync(path.join(appRootFor(p), "webview", "assets")));
}

module.exports = { platformsFor };
