#!/usr/bin/env node
/**
 * Build a Linux portable package from the patched upstream ASAR.
 *
 * Electron Forge's make step can resolve makers and still leave no out/ on
 * Linux in CI. This script keeps the same prepare/rebuild/sync flow, then uses
 * @electron/packager directly and asserts the package + zip actually exist.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync, execSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(PROJECT_ROOT, "out");
const VALID = new Set(["linux-x64", "linux-arm64"]);

function run(command, args, options = {}) {
  console.log(`\n$ ${[command, ...args].join(" ")}`);
  execFileSync(command, args, {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    ...options,
  });
}

function clearDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function zipDir(sourceDir, zipPath) {
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });

  const commands = [
    `7z a -tzip "${zipPath}" .`,
    `7zz a -tzip "${zipPath}" .`,
    `zip -r "${zipPath}" .`,
  ];

  for (const command of commands) {
    try {
      execSync(command, { cwd: sourceDir, stdio: "inherit" });
      return;
    } catch {}
  }

  throw new Error("No zip tool succeeded. Install 7z/7zz/zip on the runner.");
}

function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf-8"));
  return pkg.version || "unknown";
}

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} missing: ${filePath}`);
  const size = fs.statSync(filePath).size;
  if (size <= 0) throw new Error(`${label} is empty: ${filePath}`);
  return size;
}

async function packageLinux(arch, platformName) {
  const forgeConfig = require(path.join(PROJECT_ROOT, "forge.config.js"));
  const { packager } = require("@electron/packager");
  const packageJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf-8"));
  const electronVersion = String(packageJson.devDependencies?.electron || packageJson.dependencies?.electron || "")
    .replace(/^[^\d]*/, "");

  if (!electronVersion) throw new Error("Cannot determine Electron version");

  clearDir(OUT_DIR);

  const options = {
    ...forgeConfig.packagerConfig,
    dir: PROJECT_ROOT,
    out: OUT_DIR,
    platform: "linux",
    arch,
    overwrite: true,
    quiet: false,
    electronVersion,
    afterCopy: [
      (buildPath, electronVersionArg, targetPlatform, targetArch, done) => {
        Promise.resolve()
          .then(async () => {
            if (typeof forgeConfig.hooks?.packageAfterCopy === "function") {
              await forgeConfig.hooks.packageAfterCopy(
                forgeConfig,
                buildPath,
                electronVersionArg,
                targetPlatform,
                targetArch,
              );
            }
          })
          .then(() => done(), done);
      },
    ],
  };

  console.log(`\n== Package Linux: ${platformName} ==`);
  const outputPaths = await packager(options);
  const packageDir = outputPaths.find((p) => fs.existsSync(p) && fs.statSync(p).isDirectory());

  if (!packageDir) {
    throw new Error(`@electron/packager did not produce a package directory. outputs=${JSON.stringify(outputPaths)}`);
  }

  const appAsar = path.join(packageDir, "resources", "app.asar");
  const codexBin = path.join(packageDir, "resources", "codex");
  const rgBin = path.join(packageDir, "resources", "rg");
  assertFile(appAsar, "app.asar");
  assertFile(codexBin, "codex binary");
  assertFile(rgBin, "rg binary");

  const suffix = process.env.GITHUB_REF_NAME || readVersion();
  const zipPath = path.join(OUT_DIR, "make", "zip", "linux", arch, `Codex-linux-${arch}-${suffix}.zip`);
  console.log(`\n== Zip Linux package: ${path.relative(PROJECT_ROOT, zipPath)} ==`);
  zipDir(packageDir, zipPath);
  const zipSize = assertFile(zipPath, "Linux zip");
  console.log(`\n[ok] ${zipPath} (${(zipSize / 1048576).toFixed(1)} MB)`);
}

async function main() {
  const args = process.argv.slice(2);
  const platformIndex = args.indexOf("--platform");
  const platformName = platformIndex >= 0 ? args[platformIndex + 1] : "";
  if (!VALID.has(platformName)) {
    console.error(`[x] Usage: build-linux-from-upstream.js --platform <${[...VALID].join("|")}>`);
    process.exit(1);
  }

  const arch = platformName === "linux-arm64" ? "arm64" : "x64";
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";

  run(process.execPath, ["scripts/prepare-src.js", "--platform", platformName]);
  run(npm, ["run", `rebuild:native:${arch}`]);
  run(process.execPath, ["scripts/sync-native-modules.js", "--platform", platformName]);
  await packageLinux(arch, platformName);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
