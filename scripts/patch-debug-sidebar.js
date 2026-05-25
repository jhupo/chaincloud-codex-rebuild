#!/usr/bin/env node
/**
 * Show the sidebar Debug entry in packaged ChainCloud builds.
 */
const { locateBundles, read, relPath, write } = require("./patch-util");

function patchDebugSidebar(source) {
  let changed = false;
  const debugItem =
    "(0,$.jsx)(Iu,{icon:ip,onClick:()=>{Ny(n)},label:(0,$.jsx)(G,{id:`sidebarElectron.debugNavLink`,defaultMessage:`Debug`,description:`Nav link that opens the debug menu`})})";
  const from = "w===`dev`||w===`agent`?" + debugItem + ":null";
  const to = debugItem;

  if (source.includes(from)) {
    source = source.replace(from, to);
    changed = true;
  }
  return { source, changed };
}

function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const platform = args.find((a) => ["mac-arm64", "mac-x64", "win"].includes(a));
  const bundles = locateBundles({ dir: "assets", pattern: /^app-main-.*\.js$/, platform });
  let changed = 0;

  for (const bundle of bundles) {
    const source = read(bundle.path);
    const result = patchDebugSidebar(source);
    if (!result.changed) {
      if (!result.source.includes("sidebarElectron.debugNavLink")) continue;
      console.log(`  [ok] ${bundle.platform}: ${relPath(bundle.path)} debug sidebar already patched or no gate`);
      continue;
    }
    changed++;
    console.log(`${isCheck ? "  [?]" : "  [ok]"} ${bundle.platform}: ${relPath(bundle.path)} show debug sidebar`);
    if (!isCheck) write(bundle.path, result.source);
  }

  if (changed === 0) console.log("  [ok] debug sidebar patch not needed");
  if (isCheck && changed > 0) process.exit(1);
}

if (require.main === module) main();

module.exports = { patchDebugSidebar };
