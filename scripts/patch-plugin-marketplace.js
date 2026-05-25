#!/usr/bin/env node
/**
 * Make the Plugins page use the local OpenAI-bundled marketplace on API-key
 * auth and outside an active thread host context.
 */
const { locateBundles, read, relPath, write } = require("./patch-util");

function patchUsePlugins(source) {
  let changed = false;
  const replacements = [
    {
      from: "let v=_,y=ie.kind===`local`,b=a&&v,x;",
      to: "let v=_,y=ie.kind===`local`,b=a,x;",
    },
    {
      from: "if(!a||!v){let e;return",
      to: "if(!a){let e;return",
    },
    {
      from: "N=a&&v&&(t!==void 0||m.isFetched),P;",
      to: "N=a&&(t!==void 0||m.isFetched),P;",
    },
  ];

  for (const { from, to } of replacements) {
    if (source.includes(to)) continue;
    if (!source.includes(from)) continue;
    source = source.replace(from, to);
    changed = true;
  }

  return { source, changed };
}

function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const platform = args.find((a) => ["mac-arm64", "mac-x64", "win"].includes(a));
  const targets = locateBundles({ dir: "assets", pattern: /^use-plugins-.*\.js$/, platform });
  let touched = 0;

  for (const target of targets) {
    const source = read(target.path);
    const result = patchUsePlugins(source);
    if (!result.changed) {
      console.log(`[ok] ${target.platform}: ${relPath(target.path)} already patched or no match`);
      continue;
    }
    console.log(`${isCheck ? "[?]" : "[*]"} ${target.platform}: relax plugin host gate in ${relPath(target.path)}`);
    if (!isCheck) write(target.path, result.source);
    touched++;
  }

  if (touched === 0) console.log("[ok] No plugin marketplace patch needed");
}

main();
