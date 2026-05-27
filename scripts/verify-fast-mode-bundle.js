#!/usr/bin/env node
const assert = require("assert");
const { fs, path, SRC_DIR } = require("./patch-util");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing ${name}`);
  let depth = 0;
  let sawBody = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") {
      depth += 1;
      sawBody = true;
    } else if (ch === "}") {
      depth -= 1;
      if (sawBody && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unterminated ${name}`);
}

function loadFunction(file, name) {
  const source = fs.readFileSync(file, "utf8");
  return Function(`${extractFunction(source, name)}; return ${name};`)();
}

function loadCoreServiceTierFunctions(file) {
  const source = fs.readFileSync(file, "utf8");
  const labels = "var Df={standardLabel:`Standard`,standardDescription:`Default speed`,fastLabel:`Fast`,fastDescription:`1.5x speed, increased usage`,ultrafastLabel:`Ultrafast`,ultrafastDescription:`The fastest available responses for latency-sensitive work`};";
  const helper = source.includes("function ChainCloudFastTierModel(")
    ? extractFunction(source, "ChainCloudFastTierModel")
    : "";
  const names = ["Of", "Af", "jf", "Mf", "Nf", "Pf", "Ff", "Lf"];
  const functions = names.map((name) => extractFunction(source, name)).join(";");
  return Function(`${labels}${helper}${functions}; return { options: Nf, effective: Lf, isValid: Ff };`)();
}

function locateOne(assetsDir, pattern) {
  const match = fs.readdirSync(assetsDir).find((file) => pattern.test(file));
  if (!match) throw new Error(`Unable to locate ${pattern} in ${assetsDir}`);
  return path.join(assetsDir, match);
}

function nativeEffective(model, selected) {
  if (selected == null) return null;
  if (selected === "fast") {
    return model?.serviceTiers?.find((tier) => tier.id === "priority" || tier.id === "fast")?.id ?? null;
  }
  return model?.serviceTiers?.find((tier) => tier.id === selected)?.id ?? null;
}

function verifyPlatform(platform) {
  const assetsDir = path.join(SRC_DIR, platform, "_asar", "webview", "assets");
  const serviceFile = locateOne(assetsDir, /^use-service-tier-settings-.*\.js$/);
  const coreFile = locateOne(assetsDir, /^app-server-manager-signals-.*\.js$/);
  const buildFile = locateOne(assetsDir, /^build-start-conversation-params-.*\.js$/);

  const serviceOptions = loadFunction(serviceFile, "ChainCloudServiceTierOptions");
  const effectiveTier = loadFunction(serviceFile, "ChainCloudEffectiveServiceTier");
  const coreTier = loadCoreServiceTierFunctions(coreFile);
  const tierForAttachments = loadFunction(buildFile, "ChainCloudServiceTierForAttachments");

  const emptyModel = { serviceTiers: [] };
  const priorityModel = { serviceTiers: [{ id: "priority", name: "Priority" }] };
  const options = serviceOptions([]);
  const fastOption = options.find((option) => option.iconKind === "fast");

  assert.deepStrictEqual(
    fastOption && { value: fastOption.value, iconKind: fastOption.iconKind },
    { value: "priority", iconKind: "fast" },
    "injected Fast option must use the API priority tier and fast icon",
  );
  assert(options.some((option) => option.value == null), "Standard option must remain available");

  assert.strictEqual(effectiveTier(emptyModel, "priority", nativeEffective(emptyModel, "priority")), "priority");
  assert.strictEqual(effectiveTier(emptyModel, "fast", nativeEffective(emptyModel, "fast")), "priority");
  assert.strictEqual(effectiveTier(emptyModel, null, nativeEffective(emptyModel, null)), null);
  assert.strictEqual(effectiveTier(priorityModel, "priority", nativeEffective(priorityModel, "priority")), "priority");

  const effective = effectiveTier(emptyModel, "priority", null);
  const selected = options.find((option) => option.value === effective);
  assert.strictEqual(selected?.iconKind, "fast", "Composer selected option must resolve to the fast icon");

  const coreOptions = coreTier.options(emptyModel);
  const coreFastOption = coreOptions.find((option) => option.iconKind === "fast");
  assert.deepStrictEqual(
    coreFastOption && { value: coreFastOption.value, iconKind: coreFastOption.iconKind },
    { value: "priority", iconKind: "fast" },
    "native service-tier options must expose Fast for API-key models",
  );
  assert.strictEqual(coreTier.effective(emptyModel, "priority"), "priority");
  assert.strictEqual(coreTier.effective(emptyModel, "fast"), "priority");
  assert.strictEqual(coreTier.isValid(emptyModel, "priority"), true);
  assert.strictEqual(coreTier.isValid(emptyModel, "fast"), true);

  assert.strictEqual(tierForAttachments("priority", []), "priority");
  assert.strictEqual(tierForAttachments("fast", []), "priority");
  assert.strictEqual(tierForAttachments("priority", [{ mimeType: "text/plain", name: "readme.md" }]), "priority");
  assert.strictEqual(tierForAttachments("priority", [{ mimeType: "image/png" }]), "priority");
  assert.strictEqual(tierForAttachments("fast", [{ name: "photo.jpg" }]), "priority");

  return {
    platform,
    fastOption,
    effectiveFromPriority: effective,
    effectiveFromLegacyFast: effectiveTier(emptyModel, "fast", null),
    nativeEffectiveFromPriority: coreTier.effective(emptyModel, "priority"),
    nativeValidPriority: coreTier.isValid(emptyModel, "priority"),
    apiTextPriority: tierForAttachments("priority", []),
    apiLegacyFastNormalized: tierForAttachments("fast", []),
    apiImagePriority: tierForAttachments("priority", [{ mimeType: "image/png" }]),
    apiImageLegacyFast: tierForAttachments("fast", [{ name: "photo.jpg" }]),
  };
}

function main() {
  const platform = process.argv.find((arg) => ["mac-arm64", "mac-x64", "win"].includes(arg));
  const platforms = platform
    ? [platform]
    : ["mac-arm64", "mac-x64", "win"].filter((candidate) =>
        fs.existsSync(path.join(SRC_DIR, candidate, "_asar", "webview", "assets")),
      );
  if (platforms.length === 0) throw new Error("No extracted bundles found");
  const results = platforms.map(verifyPlatform);
  console.log(JSON.stringify(results, null, 2));
}

main();
