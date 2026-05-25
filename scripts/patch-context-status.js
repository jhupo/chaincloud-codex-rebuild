#!/usr/bin/env node
/**
 * Keep the local conversation context usage/status row visible by default.
 */
const { appRootFor, fs, path, read, relPath, write } = require("./patch-util");
const { platformsFor } = require("./chaincloud-auth/platforms");

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

    if (
      source.includes("local-conversation-status-section-visible") &&
      !/[A-Za-z_$][\w$]*=B\(`local-conversation-status-section-visible`,!0\)/.test(source)
    ) {
      throw new Error(`Unable to patch context status visibility in ${relPath(bundle)}`);
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
