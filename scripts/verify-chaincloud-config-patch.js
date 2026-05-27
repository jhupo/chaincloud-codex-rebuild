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

function loadEnsureConfig(file) {
  const source = fs.readFileSync(file, "utf8");
  const names = [
    "__chaincloudTomlStringV10",
    "__chaincloudEscapeRegExpV10",
    "__chaincloudSetTomlScalarV10",
    "__chaincloudFindTomlTableV10",
    "__chaincloudSetTomlTableScalarV10",
    "__chaincloudEnsureConfigTextV10",
  ];
  const body = [
    "var __chaincloudProviderIdV10 = 'chaincloud';",
    ...names.map((name) => extractFunction(source, name)),
    "return __chaincloudEnsureConfigTextV10;",
  ].join("\n");
  return Function(body)();
}

function locateMain(platform) {
  const buildDir = path.join(SRC_DIR, platform, "_asar", ".vite", "build");
  const file = fs.readdirSync(buildDir).find((name) => /^main-.*\.js$/.test(name));
  if (!file) throw new Error(`Unable to locate ${platform} main bundle`);
  return path.join(buildDir, file);
}

function verifyPlatform(platform) {
  const ensureConfig = loadEnsureConfig(locateMain(platform));
  const input = [
    'model_provider = "openai"',
    "",
    "[model_providers.openai]",
    'name = "OpenAI"',
    'base_url = "https://api.openai.com/v1"',
    "",
    "[model_providers.chaincloud]",
    'name = "Custom ChainCloud"',
    'base_url = "https://custom.example/v1"',
    'wire_api = "chat"',
    'ws_url = "wss://custom.example/ws"',
    'custom_header = "keep-me"',
    "",
    "[desktop]",
    'default-service-tier = "priority"',
    "",
  ].join("\n");
  const output = ensureConfig(input);
  assert(output.includes('model_provider = "chaincloud"'), "model_provider must point to chaincloud");
  assert(output.includes('[model_providers.openai]'), "other provider tables must be preserved");
  assert(output.includes('ws_url = "wss://custom.example/ws"'), "custom ws_url must be preserved");
  assert(output.includes('custom_header = "keep-me"'), "custom provider fields must be preserved");
  assert(output.includes('[desktop]'), "other config tables must be preserved");
  assert(output.includes('default-service-tier = "priority"'), "desktop fast setting must be preserved");
  assert.strictEqual((output.match(/^\[model_providers\.chaincloud\]$/gm) || []).length, 1, "chaincloud table must not be duplicated");
  assert.strictEqual((output.match(/^base_url\s*=/gm) || []).length, 2, "provider base_url keys must not be duplicated");
  assert(output.includes('base_url = "https://dash.classicriver.cn/v1"'), "chaincloud base_url must be updated");
  assert(output.includes('wire_api = "responses"'), "chaincloud wire_api must be updated");
  return { platform, ok: true };
}

function main() {
  const platform = process.argv.find((arg) => ["mac-arm64", "mac-x64", "win"].includes(arg));
  const platforms = platform
    ? [platform]
    : ["mac-arm64", "mac-x64", "win"].filter((candidate) =>
        fs.existsSync(path.join(SRC_DIR, candidate, "_asar", ".vite", "build")),
      );
  if (platforms.length === 0) throw new Error("No extracted main bundles found");
  console.log(JSON.stringify(platforms.map(verifyPlatform), null, 2));
}

main();
