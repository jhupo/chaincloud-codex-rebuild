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
 * Target: permissions-mode-helpers-*.js (or any chunk with the pattern)
 */
const fs = require("fs");
const path = require("path");
const { parse } = require("acorn");
const { relPath, SRC_DIR } = require("./patch-util");

const SERVICE_TIER_HELPER =
  "function ChainCloudServiceTierOptions(e){let t=Array.isArray(e)?e.filter(Boolean):[],n=t.some(e=>e?.value==null||e?.value===`standard`);n||(t=[{value:null,label:`Standard`,description:`Standard speed`,iconKind:null},...t]);t.some(e=>e?.value===`fast`||e?.value===`priority`||e?.iconKind===`fast`)||(t=[...t,{value:`priority`,label:`Fast`,description:`1.5x speed, increased usage`,iconKind:`fast`}]);return t}";

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

    // Inside this function, find ChatGPT-only auth gates around authMethod.
    walk(node, (child) => {
      if (child.type !== "BinaryExpression" || !["!==", "===", "!="].includes(child.operator)) return;

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
        replacement: child.operator === "===" ? "!0" : "!1",
        original: childSrc,
      });
    });
  });

  return patches;
}

function collectCurrentFastModePatches(source) {
  const patches = [];

  const requirementExprRe =
    /[A-Za-z_$][\w$]*\?\.requirements\?\.featureRequirements\?\.fast_mode===!1/g;
  let requirementExprMatch;
  while ((requirementExprMatch = requirementExprRe.exec(source))) {
    patches.push({
      id: "fast_mode_requirement_expr",
      start: requirementExprMatch.index,
      end: requirementExprMatch.index + requirementExprMatch[0].length,
      replacement: "!1",
      original: requirementExprMatch[0],
    });
  }

  const modelPredicate = source.match(/\.models\.some\(([A-Za-z_$][\w$]*)\)/);
  if (modelPredicate) {
    const fnName = modelPredicate[1];
    const fnRe = new RegExp(`function ${fnName}\\(([^)]*)\\)\\{return (?!\\!0\\})[^{}]+\\}`);
    const match = fnRe.exec(source);
    if (match) {
      patches.push({
        id: "fast_mode_model_predicate",
        start: match.index,
        end: match.index + match[0].length,
        replacement: `function ${fnName}(${match[1]}){return !0}`,
        original: match[0],
      });
    }
  }

  const reqVars = new Set();
  const reqRe = /(?:^|[,;])([A-Za-z_$][\w$]*)=[^;]*?featureRequirements\?\.fast_mode===!1/g;
  let reqMatch;
  while ((reqMatch = reqRe.exec(source))) reqVars.add(reqMatch[1]);

  for (const reqVar of reqVars) {
    const returnRe = new RegExp(`return!\\((?!\\!1\\|\\|)[^)]*\\b${reqVar}\\b\\)`, "g");
    let match;
    while ((match = returnRe.exec(source))) {
      patches.push({
        id: "fast_mode_requirement_return",
        start: match.index,
        end: match.index + match[0].length,
        replacement: `return!(!1||${reqVar})`,
        original: match[0],
      });
    }

    const ifRe = new RegExp(`if\\((?!\\!1\\|\\|)[^)]*\\b${reqVar}\\b\\)`, "g");
    while ((match = ifRe.exec(source))) {
      patches.push({
        id: "fast_mode_requirement_if",
        start: match.index,
        end: match.index + match[0].length,
        replacement: `if(!1||${reqVar})`,
        original: match[0],
      });
    }
  }

  return patches;
}

function collectServiceTierPatches(ast, source) {
  const patches = [];

  const helperMatch = /function ChainCloudServiceTierOptions\([^)]*\)\{.*?return [A-Za-z_$][\w$]*\}/.exec(source);
  if (helperMatch && helperMatch[0] !== SERVICE_TIER_HELPER) {
    patches.push({
      id: "fast_mode_service_tier_helper_upgrade",
      start: helperMatch.index,
      end: helperMatch.index + helperMatch[0].length,
      replacement: SERVICE_TIER_HELPER,
      original: helperMatch[0],
    });
  } else if (!source.includes("ChainCloudServiceTierOptions(")) {
    const insertMatch = /var [A-Za-z_$][\w$]*=u\(\);function /.exec(source);
    if (insertMatch) {
      const insertAt = insertMatch.index + insertMatch[0].length - "function ".length;
      patches.push({
        id: "fast_mode_service_tier_helper",
        start: insertAt,
        end: insertAt,
        replacement: SERVICE_TIER_HELPER,
        original: "",
      });
    }
  }

  const optionVars = new Set();
  walk(ast, (node) => {
    if (node.type !== "Property") return;
    const key = node.key;
    const isAvailableOptions =
      (key.type === "Identifier" && key.name === "availableOptions") ||
      (key.type === "Literal" && key.value === "availableOptions");
    if (isAvailableOptions && node.value?.type === "Identifier") {
      optionVars.add(node.value.name);
    }
  });

  walk(ast, (node) => {
    if (node.type !== "AssignmentExpression" || node.operator !== "=") return;
    if (node.left?.type !== "Identifier" || !optionVars.has(node.left.name)) return;
    if (node.right?.type !== "CallExpression") return;

    const callee = source.slice(node.right.callee.start, node.right.callee.end);
    if (callee === "ChainCloudServiceTierOptions") return;

    const rhs = source.slice(node.right.start, node.right.end);
    patches.push({
      id: "fast_mode_service_tier_options",
      start: node.right.start,
      end: node.right.end,
      replacement: `ChainCloudServiceTierOptions(${rhs})`,
      original: rhs,
    });
  });

  const effectiveRe =
    /([A-Za-z_$][\w$]*\.serviceTier===`fast`\?`fast`:[A-Za-z_$][\w$]*)/g;
  let effectiveMatch;
  while ((effectiveMatch = effectiveRe.exec(source))) {
    const original = effectiveMatch[1];
    const serviceTierRef = original.match(/^([A-Za-z_$][\w$]*\.serviceTier)===/)[1];
    const fallback = original.slice(original.lastIndexOf(":") + 1);
    patches.push({
      id: "fast_mode_effective_service_tier",
      start: effectiveMatch.index,
      end: effectiveMatch.index + original.length,
      replacement: `${serviceTierRef}===\`fast\`||${serviceTierRef}===\`priority\`?\`priority\`:${fallback}`,
      original,
    });
  }

  return patches;
}

function applyPatches(source, patches) {
  let code = source;
  const unique = [];
  for (const patch of patches) {
    if (!unique.some((p) => p.start === patch.start && p.end === patch.end)) unique.push(patch);
  }
  unique.sort((a, b) => b.start - a.start);
  for (const patch of unique) {
    code = code.slice(0, patch.start) + patch.replacement + code.slice(patch.end);
  }
  return { code, patches: unique };
}

function validateFastModeBundle(file, source) {
  const base = path.basename(file);
  if (/^use-is-fast-mode-enabled-.*\.js$/.test(base)) {
    const required = ["return !0", "return!(!1||", "if(!1||"];
    for (const marker of required) {
      if (!source.includes(marker)) throw new Error(`${relPath(file)} missing fast-mode marker: ${marker}`);
    }
    if (source.includes("featureRequirements?.fast_mode===!1")) {
      throw new Error(`${relPath(file)} still checks disabled fast_mode requirement`);
    }
  }

  if (/^use-service-tier-settings-.*\.js$/.test(base)) {
    const required = [
      "function ChainCloudServiceTierOptions",
      "value:`priority`",
      "iconKind:`fast`",
      "ChainCloudServiceTierOptions(",
      "=ChainCloudServiceTierOptions(",
      "availableOptions:",
    ];
    for (const marker of required) {
      if (!source.includes(marker)) throw new Error(`${relPath(file)} missing service-tier marker: ${marker}`);
    }
  }
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
    let sawFastHook = false;
    let sawServiceTier = false;
    let sawLegacyGate = false;
    for (const f of fs.readdirSync(assetsDir)) {
      if (!f.endsWith(".js")) continue;
      const fp = path.join(assetsDir, f);
      const src = fs.readFileSync(fp, "utf-8");
      const isCurrentFastHook = /^use-is-fast-mode-enabled-.*\.js$/.test(f);
      const isServiceTier = /^use-service-tier-settings-.*\.js$/.test(f);
      const isLegacyGate = src.includes("authMethod") && src.includes("fast_mode");
      sawFastHook ||= isCurrentFastHook;
      sawServiceTier ||= isServiceTier;
      sawLegacyGate ||= isLegacyGate;
      if (isCurrentFastHook || isServiceTier || isLegacyGate) {
        targets.push({ platform: plat, path: fp });
      }
    }
    if (!sawFastHook && !sawLegacyGate) {
      throw new Error(`[${plat}] Unable to locate fast-mode gate bundle`);
    }
    if (!sawServiceTier) {
      throw new Error(`[${plat}] Unable to locate service-tier settings bundle`);
    }
  }

  if (targets.length === 0) {
    console.log("  [skip] No chunk contains fast_mode gate logic");
    return;
  }

  let totalPatched = 0;
  let pendingChanges = 0;

  for (const bundle of targets) {
    const source = fs.readFileSync(bundle.path, "utf-8");

    const t0 = Date.now();
    let ast;
    try {
      ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
    } catch {
      continue;
    }

    const patches = [
      ...collectPatches(ast, source),
      ...collectCurrentFastModePatches(source),
      ...collectServiceTierPatches(ast, source),
    ];

    if (patches.length === 0) {
      validateFastModeBundle(bundle.path, source);
      continue;
    }

    console.log(
      `  [${bundle.platform}] ${relPath(bundle.path)} (parse ${Date.now() - t0}ms)`,
    );

    if (isCheck) {
      for (const p of patches) {
        console.log(`    [?] offset ${p.start}: ${p.original} -> ${p.replacement}`);
      }
      pendingChanges += patches.length;
      continue;
    }

    const patched = applyPatches(source, patches);
    for (const p of patched.patches) {
      console.log(`    * ${p.original} -> ${p.replacement}`);
    }

    validateFastModeBundle(bundle.path, patched.code);
    fs.writeFileSync(bundle.path, patched.code, "utf-8");
    totalPatched += patched.patches.length;
  }

  if (isCheck && pendingChanges > 0) {
    console.log(`  [check] ${pendingChanges} pending fast-mode change(s)`);
    process.exitCode = 1;
    return;
  }

  if (totalPatched > 0) {
    console.log(`  [ok] ${totalPatched} auth gate(s) removed`);
  } else {
    console.log("  [ok] fast_mode and service-tier patches verified");
  }
}

main();
