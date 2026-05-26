#!/usr/bin/env node
/**
 * Create a conservative Windows file-level delta update.
 *
 * The delta is intentionally simple: changed/new files are copied verbatim and
 * removed files are listed in a manifest. The client validates current file
 * hashes before applying it and falls back to the full zip if anything differs.
 */
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : "";
}

function safeTag(tag) {
  return String(tag || "").replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function clearDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "pipe", ...options });
}

function unzip(zipPath, dest) {
  fs.mkdirSync(dest, { recursive: true });
  try {
    run("unzip", ["-q", zipPath, "-d", dest]);
    return;
  } catch {}
  try {
    run("7zz", ["x", "-y", `-o${dest}`, zipPath]);
    return;
  } catch {}
  try {
    run("7z", ["x", "-y", `-o${dest}`, zipPath]);
    return;
  } catch {}
  try {
    run("tar", ["-xf", zipPath, "-C", dest]);
    return;
  } catch {}
  run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `Expand-Archive -LiteralPath ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(dest)} -Force`,
  ]);
}

function zipDir(sourceDir, zipPath) {
  zipPath = path.resolve(zipPath);
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  try {
    run("zip", ["-qr", zipPath, "."], { cwd: sourceDir });
    return;
  } catch {}
  try {
    run("7zz", ["a", "-tzip", "-mx=5", zipPath, "."], { cwd: sourceDir });
    return;
  } catch {}
  try {
    run("7z", ["a", "-tzip", "-mx=5", zipPath, "."], { cwd: sourceDir });
    return;
  } catch {}
  run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `Compress-Archive -Path * -DestinationPath ${JSON.stringify(zipPath)} -Force`,
  ], { cwd: sourceDir });
}

function findAppRoot(dir) {
  const direct = path.join(dir, "Codex.exe");
  if (fs.existsSync(direct)) return dir;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (!entry.isDirectory()) continue;
      if (fs.existsSync(path.join(full, "Codex.exe"))) return full;
      stack.push(full);
    }
  }
  throw new Error(`Cannot locate Codex.exe under ${dir}`);
}

function walkFiles(root) {
  const result = new Map();
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        const rel = path.relative(root, full).replace(/\\/g, "/");
        result.set(rel, full);
      }
    }
  }
  return result;
}

function sha256(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function main() {
  const currentZip = argValue("--current");
  const previousZip = argValue("--previous");
  const outDir = argValue("--out-dir") || "out";
  const fromTag = argValue("--from-tag");
  const toTag = argValue("--to-tag");

  if (!currentZip || !previousZip || !fromTag || !toTag) {
    console.log("[delta] missing current/previous/from-tag/to-tag, skipping delta asset");
    return;
  }
  if (!fs.existsSync(currentZip) || !fs.existsSync(previousZip)) {
    console.log("[delta] current or previous Windows zip missing, skipping delta asset");
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chaincloud-win-delta-"));
  const currentDir = path.join(tmp, "current");
  const previousDir = path.join(tmp, "previous");
  const stagingDir = path.join(tmp, "staging");
  clearDir(currentDir);
  clearDir(previousDir);
  clearDir(stagingDir);

  unzip(currentZip, currentDir);
  unzip(previousZip, previousDir);

  const currentRoot = findAppRoot(currentDir);
  const previousRoot = findAppRoot(previousDir);
  const currentFiles = walkFiles(currentRoot);
  const previousFiles = walkFiles(previousRoot);

  const files = [];
  const deletes = [];
  for (const [rel, currentFile] of [...currentFiles.entries()].sort()) {
    const currentHash = sha256(currentFile);
    const previousFile = previousFiles.get(rel);
    const previousHash = previousFile ? sha256(previousFile) : null;
    if (previousHash === currentHash) continue;
    const size = fs.statSync(currentFile).size;
    copyFile(currentFile, path.join(stagingDir, "files", rel));
    files.push({ path: rel, size, sha256: currentHash, fromSha256: previousHash });
  }
  for (const [rel, previousFile] of [...previousFiles.entries()].sort()) {
    if (currentFiles.has(rel)) continue;
    deletes.push({ path: rel, fromSha256: sha256(previousFile) });
  }

  if (files.length === 0 && deletes.length === 0) {
    console.log("[delta] no file differences, skipping delta asset");
    return;
  }

  const manifest = {
    format: 1,
    kind: "chaincloud-windows-file-delta",
    platform: "win32",
    arch: "x64",
    fromTag,
    toTag,
    files,
    deletes,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(stagingDir, "chaincloud-delta-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  const outName = `ChainCloud-win-x64-from-${safeTag(fromTag)}-to-${safeTag(toTag)}.patch.zip`;
  const outPath = path.join(outDir, outName);
  zipDir(stagingDir, outPath);
  const sizeMb = (fs.statSync(outPath).size / 1048576).toFixed(1);
  console.log(`[delta] ${outPath} (${sizeMb} MB, files=${files.length}, deletes=${deletes.length})`);
}

main();
