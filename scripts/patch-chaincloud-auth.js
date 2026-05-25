#!/usr/bin/env node
/**
 * Patch Codex desktop authentication to use ChainCloud/sub2api.
 *
 * The upstream app still needs an internal API-key authMethod for its request
 * plumbing. This patch replaces the visible login surface with a ChainCloud
 * account login, then feeds the user's selected/created sub2api key into the
 * original login-with-api-key IPC route.
 */
const { appRootFor, path, relPath } = require("./patch-util");
const { patchBillingTooltipBundles } = require("./patch-billing-tooltip");
const { patchAgentSettingsBundle } = require("./patch-settings-api-key");
const { CLIENT_FILE } = require("./chaincloud-auth/constants");
const { patchComposerBundles } = require("./chaincloud-auth/composer-bundles");
const { installClient, patchHtml, patchPreload } = require("./chaincloud-auth/webview-patches");
const { patchLocalThreadBundles } = require("./chaincloud-auth/local-thread-bundles");
const { patchLoginRoute, patchStartupAuthGate } = require("./chaincloud-auth/login-route");
const { patchMainProxy } = require("./chaincloud-auth/main-proxy");
const { platformsFor } = require("./chaincloud-auth/platforms");
const { patchProfileBundles } = require("./chaincloud-auth/profile-bundles");

function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const platform = args.find((a) => ["mac-arm64", "mac-x64", "win"].includes(a));
  const platforms = platformsFor(platform);

  if (platforms.length === 0) {
    console.log("[skip] No extracted ASAR assets found");
    return;
  }

  let changedCount = 0;
  for (const plat of platforms) {
    console.log(`\n-- [${plat}] ChainCloud auth`);
    const clientChanged = installClient(plat, isCheck);
    const htmlChanged = patchHtml(plat, isCheck);
    const preloadChanged = patchPreload(plat, isCheck);
    const mainProxy = patchMainProxy(plat, isCheck);
    const startupGate = patchStartupAuthGate(plat, isCheck);
    const login = patchLoginRoute(plat, isCheck);
    const profileTouched = patchProfileBundles(plat, isCheck);
    const composerTouched = patchComposerBundles(plat, isCheck);
    const billingTooltipTouched = patchBillingTooltipBundles(plat, isCheck);
    const localThreadTouched = patchLocalThreadBundles(plat, isCheck);
    const agentSettings = patchAgentSettingsBundle(plat, isCheck);

    for (const [label, changed, file] of [
      ["client", clientChanged, path.join(appRootFor(plat), "webview", "assets", CLIENT_FILE)],
      ["html", htmlChanged, path.join(appRootFor(plat), "webview", "index.html")],
      ["preload", preloadChanged, path.join(appRootFor(plat), ".vite", "build", "preload.js")],
      ["main-proxy", mainProxy.changed, mainProxy.file],
      ["startup-gate", startupGate.changed, startupGate.file],
      ["login", login.changed, login.file],
      ["agent-settings", agentSettings.changed, agentSettings.file],
    ]) {
      if (changed) {
        changedCount++;
        console.log(`   * ${label}: ${file ? relPath(file) : "n/a"}`);
      } else {
        console.log(`   [ok] ${label}: already patched`);
      }
    }
    for (const file of profileTouched) {
      changedCount++;
      console.log(`   * profile: ${relPath(file)}`);
    }
    if (profileTouched.length === 0) console.log("   [ok] profile: already patched or not present");
    for (const file of composerTouched) {
      changedCount++;
      console.log(`   * composer: ${relPath(file)}`);
    }
    if (composerTouched.length === 0) console.log("   [ok] composer: already patched or not present");
    for (const file of billingTooltipTouched) {
      changedCount++;
      console.log(`   * billing-tooltip: ${relPath(file)}`);
    }
    if (billingTooltipTouched.length === 0) console.log("   [ok] billing-tooltip: already patched or not present");
    for (const file of localThreadTouched) {
      changedCount++;
      console.log(`   * local-thread: ${relPath(file)}`);
    }
    if (localThreadTouched.length === 0) console.log("   [ok] local-thread: already patched or not present");
  }

  console.log(isCheck ? `\n[check] ${changedCount} pending change(s)` : `\n[ok] ChainCloud auth patch complete (${changedCount} change(s))`);
  if (isCheck && changedCount > 0) process.exitCode = 1;
}

main();
