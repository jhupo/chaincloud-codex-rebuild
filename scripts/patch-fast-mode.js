#!/usr/bin/env node
/**
 * Post-build patch: Force-enable Fast mode (speed selector)
 *
 * The speed selector is gated by authMethod === "chatgpt" checks.
 * API-key users never see it because their authMethod differs.
 *
 * This patch locates BinaryExpression nodes matching:
 *   X.authMethod !== "chatgpt"
 * inside functions that also reference "fast_mode", and replaces
 * the comparison with !1 (always false), removing the auth gate.
 *
 * Target: permissions-mode-helpers-*.js (or any chunk with the pattern), plus
 * use-is-fast-mode-enabled-*.js in newer Codex builds where the selector is
 * gated by model service tier metadata. Newer builds also derive the dropdown
 * entries from model metadata, so ChainCloud needs a local Fast option injected
 * even when the upstream model list does not advertise extra service tiers.
 */
const fs = require("fs");
const path = require("path");
const { parse } = require("acorn");
const { locateBundles, relPath, SRC_DIR } = require("./patch-util");

function walk(node, visitor) {
  if (!node || typeof node !== "object") return;
  if (node.type) visitor(node);
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && item.type) walk(item, visitor);
      }
    } else if (child && typeof child === "object" && child.type) {
      walk(child, visitor);
    }
  }
}

function collectPatches(ast, source) {
  const patches = [];

  walk(ast, (node) => {
    // Match function bodies containing both authMethod and fast_mode
    const isFn =
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression";
    if (!isFn) return;

    const fnSrc = source.slice(node.start, node.end);
    if (!fnSrc.includes("authMethod") || !fnSrc.includes("fast_mode")) return;

    // Inside this function, find: X.authMethod !== `chatgpt`
    walk(node, (child) => {
      if (child.type !== "BinaryExpression" || child.operator !== "!==") return;

      const childSrc = source.slice(child.start, child.end);
      if (!childSrc.includes("authMethod") || !childSrc.includes("chatgpt"))
        return;

      if (childSrc === "!1") return;

      // Avoid duplicate patches at same offset
      if (patches.some((p) => p.start === child.start)) return;

      patches.push({
        id: "fast_mode_auth_gate",
        start: child.start,
        end: child.end,
        replacement: "!1",
        original: childSrc,
      });
    });
  });

  return patches;
}

function patchModelTierGate(source) {
  const replacements = [
    {
      from: "function m(e){return e.serviceTiers.length>0||e.additionalSpeedTiers?.includes(u)===!0}",
      to: "function m(e){return !0}",
    },
    {
      from: "function m(e){return e.serviceTiers?.length>0||e.additionalSpeedTiers?.includes(u)===!0}",
      to: "function m(e){return !0}",
    },
  ];

  let changed = false;
  for (const { from, to } of replacements) {
    if (source.includes(from)) {
      source = source.replace(from, to);
      changed = true;
    }
  }
  return { source, changed };
}

function patchServiceTierSettings(source) {
  let changed = false;
  const helper =
    "function ChainCloudServiceTierOptions(e){let t=Array.isArray(e)?e.filter(Boolean):[],n=t.some(e=>e?.value==null||e?.value===`standard`);n||(t=[{value:null,label:`Standard`,description:`Standard speed`,iconKind:null},...t]);t.some(e=>e?.value===`fast`)||(t=[...t,{value:`fast`,label:`Fast`,description:`Fast responses`,iconKind:`fast`}]);return t}";

  if (!source.includes("function ChainCloudServiceTierOptions(")) {
    const insertAt = source.indexOf("function _(");
    if (insertAt >= 0) {
      source = source.slice(0, insertAt) + helper + source.slice(insertAt);
      changed = true;
    }
  }

  if (source.includes("F=i(k)")) {
    source = source.replaceAll("F=i(k)", "F=ChainCloudServiceTierOptions(i(k))");
    changed = true;
  }

  if (source.includes("let j=A,M=")) {
    source = source.replace("let j=A,M=", "let j=A??(T.serviceTier===`fast`?`fast`:A),M=");
    changed = true;
  }

  return { source, changed };
}

function patchComposerFastIndicator(source) {
  let changed = false;
  const from = "L=I!=null&&Se(e,F)";
  const to = "L=I!=null&&(F===`fast`||Se(e,F))";
  if (source.includes(from)) {
    source = source.replace(from, to);
    changed = true;
  }
  return { source, changed };
}

function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const platform = args.find((a) =>
    ["mac-arm64", "mac-x64", "win"].includes(a),
  );

  const platforms = platform
    ? [platform]
    : ["mac-arm64", "mac-x64", "win"].filter((p) =>
        fs.existsSync(path.join(SRC_DIR, p, "_asar", "webview", "assets")),
      );

  const targets = [];
  for (const plat of platforms) {
    const assetsDir = path.join(SRC_DIR, plat, "_asar", "webview", "assets");
    if (!fs.existsSync(assetsDir)) continue;
    for (const f of fs.readdirSync(assetsDir)) {
      if (!f.endsWith(".js")) continue;
      const fp = path.join(assetsDir, f);
      const src = fs.readFileSync(fp, "utf-8");
      if (src.includes("authMethod") && src.includes("fast_mode")) {
        targets.push({ platform: plat, path: fp });
      }
    }
  }

  if (targets.length === 0) {
    console.log("  [skip] No chunk contains fast_mode gate logic");
    return;
  }

  let totalPatched = 0;
  let totalTierGatesPatched = 0;
  let totalTierSettingsPatched = 0;
  let totalComposerIndicatorsPatched = 0;

  for (const bundle of targets) {
    const source = fs.readFileSync(bundle.path, "utf-8");

    const t0 = Date.now();
    let ast;
    try {
      ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
    } catch {
      continue;
    }

    const patches = collectPatches(ast, source);

    if (patches.length === 0) continue;

    console.log(
      `  [${bundle.platform}] ${relPath(bundle.path)} (parse ${Date.now() - t0}ms)`,
    );

    if (isCheck) {
      for (const p of patches) {
        console.log(`    [?] offset ${p.start}: ${p.original} -> ${p.replacement}`);
      }
      continue;
    }

    patches.sort((a, b) => b.start - a.start);

    let code = source;
    for (const p of patches) {
      console.log(`    * ${p.original} -> ${p.replacement}`);
      code = code.slice(0, p.start) + p.replacement + code.slice(p.end);
    }

    fs.writeFileSync(bundle.path, code, "utf-8");
    totalPatched += patches.length;
  }

  for (const plat of platforms) {
    const assetsDir = path.join(SRC_DIR, plat, "_asar", "webview", "assets");
    if (!fs.existsSync(assetsDir)) continue;
    for (const f of fs.readdirSync(assetsDir)) {
      if (!/^use-is-fast-mode-enabled-.*\.js$/.test(f)) continue;
      const fp = path.join(assetsDir, f);
      const source = fs.readFileSync(fp, "utf-8");
      const result = patchModelTierGate(source);
      if (!result.changed) continue;
      console.log(`  [${plat}] ${relPath(fp)}`);
      console.log("    * force fast mode model tier gate open");
      if (!isCheck) fs.writeFileSync(fp, result.source, "utf-8");
      totalTierGatesPatched += 1;
    }
  }

  for (const plat of platforms) {
    const assetsDir = path.join(SRC_DIR, plat, "_asar", "webview", "assets");
    if (!fs.existsSync(assetsDir)) continue;
    for (const f of fs.readdirSync(assetsDir)) {
      if (!/^use-service-tier-settings-.*\.js$/.test(f)) continue;
      const fp = path.join(assetsDir, f);
      const source = fs.readFileSync(fp, "utf-8");
      const result = patchServiceTierSettings(source);
      if (!result.changed) continue;
      console.log(`  [${plat}] ${relPath(fp)}`);
      console.log("    * inject ChainCloud standard/fast service tier options");
      if (!isCheck) fs.writeFileSync(fp, result.source, "utf-8");
      totalTierSettingsPatched += 1;
    }
  }

  for (const plat of platforms) {
    const assetsDir = path.join(SRC_DIR, plat, "_asar", "webview", "assets");
    if (!fs.existsSync(assetsDir)) continue;
    for (const f of fs.readdirSync(assetsDir)) {
      if (!/^composer-(?!atoms-).*\.js$/.test(f)) continue;
      const fp = path.join(assetsDir, f);
      const source = fs.readFileSync(fp, "utf-8");
      const result = patchComposerFastIndicator(source);
      if (!result.changed) continue;
      console.log(`  [${plat}] ${relPath(fp)}`);
      console.log("    * show fast service tier indicator in composer");
      if (!isCheck) fs.writeFileSync(fp, result.source, "utf-8");
      totalComposerIndicatorsPatched += 1;
    }
  }

  if (totalPatched > 0 || totalTierGatesPatched > 0 || totalTierSettingsPatched > 0 || totalComposerIndicatorsPatched > 0) {
    const bits = [];
    if (totalPatched > 0) bits.push(`${totalPatched} auth gate(s) removed`);
    if (totalTierGatesPatched > 0) bits.push(`${totalTierGatesPatched} model tier gate(s) opened`);
    if (totalTierSettingsPatched > 0) bits.push(`${totalTierSettingsPatched} service tier list(s) opened`);
    if (totalComposerIndicatorsPatched > 0) bits.push(`${totalComposerIndicatorsPatched} composer fast indicator(s) patched`);
    console.log(`  [ok] ${bits.join(", ")}`);
  } else {
    console.log("  [ok] fast_mode auth gates already patched or absent");
  }
}

main();
