#!/usr/bin/env node
/**
 * ChainCloud compatibility patch:
 * normalize legacy/local "fast" service tier values to the API "priority"
 * tier before building conversation params.
 */
const { locateBundles, read, relPath, write } = require("./patch-util");

const HELPER =
  "function ChainCloudServiceTierForAttachments(e,t){return e===`fast`?`priority`:e}";

function patchBundle(file, isCheck) {
  let source = read(file);
  const original = source;
  if (!source.includes("function o({agentMode:") || !source.includes("serviceTier:d")) return false;

  source = source.replace(/function ChainCloudServiceTierForAttachments\([^]*?\}function o\(/, `${HELPER}function o(`);

  if (!source.includes("function ChainCloudServiceTierForAttachments(")) {
    source = source.replace("function o({agentMode:", `${HELPER}function o({agentMode:`);
  }

  source = source.replace(
    "let b=(0,a.default)([...p,...m],i.default),x=n(e,t,r);return{input:c,commentAttachments:l,workspaceRoots:t,collaborationMode:u,...d===void 0?{}:{serviceTier:d},",
    "let b=(0,a.default)([...p,...m],i.default),S=ChainCloudServiceTierForAttachments(d,b),x=n(e,t,r);return{input:c,commentAttachments:l,workspaceRoots:t,collaborationMode:u,...S===void 0?{}:{serviceTier:S},",
  );

  validate(file, source);
  if (source === original) return false;
  if (!isCheck) write(file, source);
  return true;
}

function validate(file, source) {
  const required = [
    "function ChainCloudServiceTierForAttachments",
    "serviceTier:S",
    "e===`fast`?`priority`:e",
  ];
  for (const marker of required) {
    if (!source.includes(marker)) throw new Error(`${relPath(file)} missing image fast-tier marker: ${marker}`);
  }
  if (source.includes("...d===void 0?{}:{serviceTier:d}")) {
    throw new Error(`${relPath(file)} still sends raw serviceTier`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const platform = args.find((arg) => ["mac-arm64", "mac-x64", "win"].includes(arg));
  const bundles = locateBundles({
    dir: "assets",
    pattern: /^build-start-conversation-params-.*\.js$/,
    platform,
  });
  if (bundles.length === 0) throw new Error("Unable to locate build-start-conversation-params bundle");

  let pending = 0;
  for (const bundle of bundles) {
    const changed = patchBundle(bundle.path, isCheck);
    if (changed) pending += 1;
    console.log(`  [${changed ? (isCheck ? "would patch" : "patched") : "ok"}] ${bundle.platform}: ${relPath(bundle.path)}`);
  }
  if (isCheck && pending > 0) {
    console.error(`\n[x] ${pending} bundle(s) need image fast-tier patch`);
    process.exit(1);
  }
}

main();
