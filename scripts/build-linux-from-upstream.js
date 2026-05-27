#!/usr/bin/env node
/**
 * Build a Linux portable package from the patched upstream ASAR.
 *
 * Electron Forge's Linux make step proved too quiet in CI when it failed to
 * create output. This script keeps the prepare/rebuild/sync flow, then
 * assembles the package from Electron's Linux dist directory.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
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

function readElectronVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf-8"));
  return String(pkg.devDependencies?.electron || pkg.dependencies?.electron || "").replace(/^[^\d]*/, "");
}

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} missing: ${filePath}`);
  const size = fs.statSync(filePath).size;
  if (size <= 0) throw new Error(`${label} is empty: ${filePath}`);
  return size;
}

function copyRecursive(src, dest, options = {}) {
  const { skip = new Set(), chmodExecutable = false } = options;
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const sourcePath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyRecursive(sourcePath, destPath, options);
    } else if (!entry.isSymbolicLink()) {
      fs.copyFileSync(sourcePath, destPath);
      if (chmodExecutable) {
        try { fs.chmodSync(destPath, 0o755); } catch {}
      }
      count++;
    }
  }
  return count;
}

function createLinuxAppSource() {
  const appSource = path.join(os.tmpdir(), "chaincloud-linux-app-source");
  clearDir(appSource);
  const allowed = [".vite", "webview", "skills", "native-menu-locales", "node_modules", "package.json"];
  let count = 0;
  for (const name of allowed) {
    const source = path.join(PROJECT_ROOT, "src", name);
    if (!fs.existsSync(source)) continue;
    const dest = path.join(appSource, name);
    const stat = fs.statSync(source);
    if (stat.isDirectory()) {
      count += copyRecursive(source, dest);
    } else {
      fs.copyFileSync(source, dest);
      count++;
    }
  }
  console.log(`   [app source] ${count} files`);
  return appSource;
}

function runAsarPack(srcDir, asarPath) {
  const candidates = [
    path.join(PROJECT_ROOT, "node_modules", ".bin", process.platform === "win32" ? "asar.cmd" : "asar"),
    path.join(PROJECT_ROOT, "node_modules", ".bin", "asar"),
    path.join(PROJECT_ROOT, "node_modules", "@electron", "asar", "bin", "asar.mjs"),
  ];
  const asarBin = candidates.find((candidate) => fs.existsSync(candidate));
  if (!asarBin) throw new Error("Local @electron/asar CLI not found. Run npm ci first.");
  const command = asarBin.endsWith(".mjs")
    ? `"${process.execPath}" "${asarBin}"`
    : `"${asarBin}"`;
  execSync(`${command} pack "${srcDir}" "${asarPath}"`, { cwd: PROJECT_ROOT, stdio: "inherit" });
}

async function resolveElectronDist(arch) {
  const version = readElectronVersion();
  if (!version) throw new Error("Cannot determine Electron version");

  if (process.platform === "linux" && process.arch === arch) {
    try {
      const electronPath = require("electron");
      const dist = path.dirname(electronPath);
      if (fs.existsSync(path.join(dist, "electron"))) return dist;
    } catch {}
  }

  const dist = path.join(os.tmpdir(), "chaincloud-electron-shell", `electron-v${version}-linux-${arch}`);
  if (fs.existsSync(path.join(dist, "electron"))) return dist;

  console.log(`   [electron] downloading linux-${arch} v${version}`);
  clearDir(dist);
  const { downloadArtifact } = require("@electron/get");
  const extract = require("extract-zip");
  const zip = await downloadArtifact({
    version,
    artifactName: "electron",
    platform: "linux",
    arch,
    checksums: require(path.join(PROJECT_ROOT, "node_modules", "electron", "checksums.json")),
  });
  await extract(zip, { dir: dist });
  assertFile(path.join(dist, "electron"), `Electron linux-${arch} executable`);
  return dist;
}

async function packageLinux(arch, platformName) {
  const electronDist = await resolveElectronDist(arch);
  const packageDir = path.join(OUT_DIR, `Codex-linux-${arch}`);
  const resourcesDir = path.join(packageDir, "resources");
  const appAsar = path.join(resourcesDir, "app.asar");
  const sourcePlatformDir = path.join(PROJECT_ROOT, "src", platformName === "linux-arm64" ? "mac-arm64" : "mac-x64");

  console.log(`\n== Assemble Linux package: ${platformName} ==`);
  console.log(`   electron dist: ${electronDist}`);
  clearDir(OUT_DIR);
  const shellFiles = copyRecursive(electronDist, packageDir);
  console.log(`   [electron] copied ${shellFiles} files`);
  const electronBin = path.join(packageDir, "electron");
  const codexExe = path.join(packageDir, "Codex");
  if (fs.existsSync(electronBin)) fs.renameSync(electronBin, codexExe);
  try { fs.chmodSync(codexExe, 0o755); } catch {}

  fs.mkdirSync(resourcesDir, { recursive: true });
  const MACOS_ONLY_FILES = new Set([
    "node", "node_repl",
    "electron.icns", "Assets.car",
    "codexTemplate.png", "codexTemplate@2x.png",
    "app.asar", "codex-notification.wav",
  ]);
  const MACOS_ONLY_DIRS = new Set(["_asar", "native", "app.asar.unpacked"]);
  let resourceCount = 0;
  for (const entry of fs.readdirSync(sourcePlatformDir, { withFileTypes: true })) {
    if (MACOS_ONLY_FILES.has(entry.name) || MACOS_ONLY_DIRS.has(entry.name) || entry.name.endsWith(".lproj")) continue;
    const source = path.join(sourcePlatformDir, entry.name);
    const dest = path.join(resourcesDir, entry.name);
    if (entry.isDirectory()) {
      resourceCount += copyRecursive(source, dest);
    } else if (!entry.isSymbolicLink()) {
      fs.copyFileSync(source, dest);
      try { fs.chmodSync(dest, 0o755); } catch {}
      resourceCount++;
    }
  }
  console.log(`   [resources] copied ${resourceCount} files`);

  const appSource = createLinuxAppSource();
  console.log("   [asar pack] src/ -> resources/app.asar");
  runAsarPack(appSource, appAsar);

  for (const bin of ["codex", "rg"]) {
    const source = path.join(sourcePlatformDir, bin);
    const dest = path.join(resourcesDir, bin);
    fs.copyFileSync(source, dest);
    try { fs.chmodSync(dest, 0o755); } catch {}
    console.log(`   [bin] ${bin}`);
  }

  const codexBin = path.join(packageDir, "resources", "codex");
  const rgBin = path.join(packageDir, "resources", "rg");
  assertFile(codexExe, "Codex executable");
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
