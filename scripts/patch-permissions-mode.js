#!/usr/bin/env node
/**
 * Keep the full composer permissions menu available for ChainCloud API-key auth.
 */
const { fs, locateBundles, read, relPath, write } = require("./patch-util");

function patchPermissionsModeHelpers(source) {
  let changed = false;
  const from =
    "let l=e?[`read-only`,`auto`,`granular`,`full-access`,`custom`]:n(t,r),u=s(r??void 0)??!0,d=a,";
  const to =
    "let l=[`read-only`,`auto`,`granular`,`guardian-approvals`,`full-access`,`custom`],u=s(r??void 0)??!0,d=!0,";
  if (source.includes(from)) {
    source = source.replace(from, to);
    changed = true;
  }
  return { source, changed };
}

function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const platform = args.find((arg) => ["mac-arm64", "mac-x64", "win"].includes(arg));
  const bundles = locateBundles({
    dir: "assets",
    pattern: /^permissions-mode-helpers-.*\.js$/,
    platform,
  });

  let changed = 0;
  for (const bundle of bundles) {
    const source = read(bundle.path);
    const result = patchPermissionsModeHelpers(source);
    if (!result.changed) {
      if (!source.includes("guardian-approvals`,`full-access`,`custom`],u=s(r??void 0)??!0,d=!0")) {
        throw new Error(`Unable to patch permissions modes in ${relPath(bundle.path)}`);
      }
      continue;
    }
    changed++;
    console.log(`  [${bundle.platform}] ${relPath(bundle.path)}`);
    console.log("    * force default/custom/auto-review permissions modes visible");
    if (!isCheck) write(bundle.path, result.source);
  }

  if (changed === 0) console.log("  [ok] permissions mode menu already patched");
  if (isCheck && changed > 0) process.exit(1);
}

if (require.main === module) main();

module.exports = { patchPermissionsModeHelpers };
