#!/usr/bin/env node
/**
 * Patch Codex desktop authentication to use ChainCloud/sub2api.
 *
 * The upstream app still needs an internal API-key authMethod for its request
 * plumbing. This patch replaces the visible login surface with a ChainCloud
 * account login, then feeds the user's selected/created sub2api key into the
 * original login-with-api-key IPC route.
 */
const fs = require("fs");
const path = require("path");
const { SRC_DIR, PROJECT_ROOT, relPath } = require("./patch-util");

const CHAINCLOUD_ORIGIN = "https://dash.classicriver.cn";
const CHAINCLOUD_API_BASE = `${CHAINCLOUD_ORIGIN}/api/v1`;
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
const QR_IMAGE_ORIGIN = "https://api.qrserver.com";
const CHAINCLOUD_IPC_CHANNEL = "codex_desktop:chaincloud-auth-request";
const CHAINCLOUD_LOGIN_IPC_CHANNEL = "codex_desktop:chaincloud-site-login";
const CHAINCLOUD_LOGOUT_IPC_CHANNEL = "codex_desktop:chaincloud-site-logout";
const CLIENT_FILE = "chaincloud-auth.js";
const PATCH_MARKER = "__CHAINCLOUD_CODEX_AUTH_PATCH__";

function platformsFor(argPlatform) {
  const all = ["mac-arm64", "mac-x64", "win", "preview-win"];
  const requested = argPlatform === "win" ? ["win", "preview-win"] : argPlatform ? [argPlatform] : all;
  return requested.filter((p) => fs.existsSync(path.join(appRootFor(p), "webview", "assets")));
}

function appRootFor(platform) {
  if (platform === "preview-win") {
    return path.join(PROJECT_ROOT, "out", "chaincloud-preview", "Codex-win32-x64", "resources", "app");
  }
  return path.join(SRC_DIR, platform, "_asar");
}

function read(file) {
  return fs.readFileSync(file, "utf-8");
}

function write(file, content) {
  fs.writeFileSync(file, content, "utf-8");
}

function jsClientSource() {
  return `// ${PATCH_MARKER}
(function(){
  const API_BASE = ${JSON.stringify(CHAINCLOUD_API_BASE)};
  const STORAGE_KEY = "chaincloud.codex.session.v1";
  const DESKTOP_KEY_NAME = "Codex Desktop";

  function now(){ return Date.now(); }
  function normalizeSession(raw){
    if (!raw || typeof raw !== "object") return null;
    if (!raw.accessToken) return null;
    return {
      baseUrl: raw.baseUrl || API_BASE,
      accessToken: raw.accessToken,
      refreshToken: raw.refreshToken || "",
      expiresAt: Number(raw.expiresAt || 0),
      tokenType: raw.tokenType || "Bearer",
      user: raw.user || null,
      selectedApiKey: raw.selectedApiKey || null,
      billingSummary: raw.billingSummary || null,
      cachedAt: Number(raw.cachedAt || now())
    };
  }
  function getSession(){
    try { return normalizeSession(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")); }
    catch { return null; }
  }
  function saveSession(session){
    const normalized = normalizeSession(session);
    if (!normalized) return null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...normalized, cachedAt: now() }));
    window.dispatchEvent(new CustomEvent("chaincloud-auth-changed", { detail: normalized }));
    return normalized;
  }
  function clearSession(){
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent("chaincloud-auth-changed"));
  }
  function displayName(){
    const s = getSession();
    return s?.user?.username || s?.user?.email || "";
  }
  function isLoggedIn(){ return !!getSession()?.accessToken; }
  function unwrap(payload){
    if (payload && typeof payload === "object" && "code" in payload) {
      if (payload.code === 0) return payload.data;
      throw new Error(payload.message || payload.error || "Request failed");
    }
    return payload;
  }
  async function bridgeFetch(path, opts){
    const bridge = window.electronBridge?.chaincloudRequest;
    if (typeof bridge !== "function") return null;
    return bridge({
      path,
      method: opts.method || "GET",
      headers: opts.headers || {},
      body: opts.body == null ? undefined : JSON.stringify(opts.body)
    });
  }
  async function request(path, options){
    const opts = options || {};
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    if (opts.auth !== false) {
      const session = await ensureFreshSession();
      if (session?.accessToken) headers.Authorization = "Bearer " + session.accessToken;
    }
    const res = await bridgeFetch(path, { ...opts, headers }) || await fetch(API_BASE + path, {
      method: opts.method || "GET",
      headers,
      body: opts.body == null ? undefined : JSON.stringify(opts.body),
      credentials: "include"
    });
    let payload = null;
    const text = typeof res.text === "function" ? await res.text() : (res.text || "");
    if (text) {
      try { payload = JSON.parse(text); }
      catch { payload = text; }
    }
    if (!res.ok) {
      const message = payload?.message || payload?.error || payload?.detail || res.statusText;
      throw new Error(message || ("HTTP " + res.status));
    }
    return unwrap(payload);
  }
  async function getPublicSettings(){ return request("/settings/public", { auth: false }); }
  async function login(email, password, turnstileToken){
    const body = { email, password };
    if (turnstileToken) body.turnstile_token = turnstileToken;
    const data = await request("/auth/login", {
      method: "POST",
      auth: false,
      body
    });
    const expiresIn = Number(data?.expires_in || 0);
    const session = saveSession({
      baseUrl: API_BASE,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || "",
      expiresAt: expiresIn > 0 ? now() + expiresIn * 1000 : 0,
      tokenType: data.token_type || "Bearer",
      user: data.user || null
    });
    try { await refreshProfile(); } catch {}
    return session || getSession();
  }
  async function loginWithSiteWindow(){
    const bridge = window.electronBridge?.chaincloudSiteLogin;
    if (typeof bridge !== "function") throw new Error("Desktop login bridge unavailable");
    const data = await bridge();
    const accessToken = data?.access_token || data?.accessToken || "";
    if (!accessToken) throw new Error("Site login did not return an access token");
    const expiresAt = Number(data?.token_expires_at || data?.expiresAt || 0);
    const expiresIn = Number(data?.expires_in || 0);
    const session = saveSession({
      baseUrl: API_BASE,
      accessToken,
      refreshToken: data?.refresh_token || data?.refreshToken || "",
      expiresAt: expiresAt || (expiresIn > 0 ? now() + expiresIn * 1000 : 0),
      tokenType: data?.token_type || data?.tokenType || "Bearer",
      user: data?.user || null
    });
    try { await refreshProfile(); } catch {}
    return session || getSession();
  }
  async function completeSiteLogin(data){
    const accessToken = data?.access_token || data?.accessToken || "";
    if (!accessToken) throw new Error("Site login did not return an access token");
    const expiresAt = Number(data?.token_expires_at || data?.expiresAt || 0);
    const expiresIn = Number(data?.expires_in || 0);
    const session = saveSession({
      baseUrl: API_BASE,
      accessToken,
      refreshToken: data?.refresh_token || data?.refreshToken || "",
      expiresAt: expiresAt || (expiresIn > 0 ? now() + expiresIn * 1000 : 0),
      tokenType: data?.token_type || data?.tokenType || "Bearer",
      user: data?.user || null
    });
    try { await refreshProfile(); } catch {}
    return session || getSession();
  }
  async function refreshToken(){
    const session = getSession();
    if (!session?.refreshToken) return session;
    const res = await bridgeFetch("/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { refresh_token: session.refreshToken }
    }) || await fetch(API_BASE + "/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ refresh_token: session.refreshToken })
    });
    const raw = typeof res.text === "function" ? await res.text() : (res.text || "");
    const payload = unwrap(raw ? JSON.parse(raw) : null);
    if (!res.ok || !payload?.access_token) throw new Error("Token refresh failed");
    return saveSession({
      ...session,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || session.refreshToken,
      expiresAt: payload.expires_in ? now() + Number(payload.expires_in) * 1000 : session.expiresAt,
      tokenType: payload.token_type || session.tokenType
    });
  }
  async function ensureFreshSession(){
    const session = getSession();
    if (!session) return null;
    if (!session.expiresAt || session.expiresAt - now() > 60000) return session;
    try { return await refreshToken(); }
    catch {
      clearSession();
      throw new Error("\u767b\u5f55\u5df2\u8fc7\u671f\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55");
    }
  }
  async function refreshProfile(){
    const user = await request("/auth/me");
    const session = getSession();
    if (session) saveSession({ ...session, user });
    return user;
  }
  function listItems(data){
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.records)) return data.records;
    return [];
  }
  async function listKeys(){
    return listItems(await request("/keys?page=1&page_size=100"));
  }
  async function createDesktopKey(){
    return request("/keys", { method: "POST", body: { name: DESKTOP_KEY_NAME } });
  }
  async function ensureDesktopApiKey(){
    let keys = await listKeys();
    let key = keys.find((k) => k && k.status === "active" && k.key)
      || keys.find((k) => k && (k.status == null || k.status === "active") && k.key)
      || null;
    if (!key) key = await createDesktopKey();
    if (!key?.key) throw new Error("\u672a\u80fd\u83b7\u53d6\u53ef\u7528\u4e8e Codex \u7684 API Key");
    const session = getSession();
    if (session) saveSession({ ...session, selectedApiKey: key });
    return key;
  }
  let keyCache = null;
  let keyCacheAt = 0;
  async function getCachedKeys(force){
    if (!force && keyCache && now() - keyCacheAt < 30000) return keyCache;
    keyCache = (await listKeys()).filter((key) => key && key.key && (key.status == null || key.status === "active"));
    keyCacheAt = now();
    return keyCache;
  }
  function keyLabel(key){
    const name = key?.name || "Key";
    const value = String(key?.key || "");
    const masked = value.length > 12 ? value.slice(0, 7) + "..." + value.slice(-4) : value;
    return masked ? name + " (" + masked + ")" : name;
  }
  async function waitForApiKeySwitcher(){
    if (typeof window.__chaincloudCodexSwitchApiKey === "function") return window.__chaincloudCodexSwitchApiKey;
    const started = now();
    while (now() - started < 4000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (typeof window.__chaincloudCodexSwitchApiKey === "function") return window.__chaincloudCodexSwitchApiKey;
    }
    return null;
  }
  async function switchDesktopApiKey(key){
    if (!key?.key) throw new Error("Invalid API key");
    const session = getSession();
    if (session) saveSession({ ...session, selectedApiKey: key });
    const switcher = await waitForApiKeySwitcher();
    if (switcher) await switcher(key.key);
    else console.warn("[ChainCloud] Codex API key switcher is not ready yet");
    window.dispatchEvent(new CustomEvent("chaincloud-api-key-selected", { detail: key }));
    return key;
  }
  function numberFrom(value){
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
  function pickNumber(obj, names){
    if (!obj || typeof obj !== "object") return null;
    for (const name of names) {
      const value = numberFrom(obj[name]);
      if (value != null) return value;
    }
    return null;
  }
  function formatMoney(value){
    const amount = numberFrom(value);
    if (amount == null) return "--";
    return "$" + amount.toFixed(2);
  }
  function billingPopoverText(){
    const summary = getSession()?.billingSummary;
    if (!summary) return "\u4eca\u65e5\u6d88\u8d39 --\\n\u5269\u4f59\u91d1\u989d --";
    return "\u4eca\u65e5\u6d88\u8d39 " + formatMoney(summary.todaySpent) + "\\n\u5269\u4f59\u91d1\u989d " + formatMoney(summary.remaining);
  }
  let billingRefreshPromise = null;
  let billingRefreshAt = 0;
  async function refreshBillingSummary(force){
    const session = getSession();
    if (!session?.accessToken) return null;
    if (!force && session.billingSummary && now() - Number(session.billingSummary.cachedAt || 0) < 30000) return session.billingSummary;
    if (!force && billingRefreshPromise && now() - billingRefreshAt < 10000) return billingRefreshPromise;
    billingRefreshAt = now();
    billingRefreshPromise = (async () => {
      let user = null, userProfile = null, dashboard = null, todayStats = null, todayUsage = null;
      try { user = await refreshProfile(); } catch {}
      try { userProfile = await request("/user/profile"); } catch {}
      try { dashboard = await getUsageSummary(); } catch {}
      try { todayStats = await getUsageStats("today"); } catch {}
      try { todayUsage = await getUsageByDateRange(todayDateString(), todayDateString()); } catch {}
      const profile = userProfile || user;
      const remaining = pickNumber(profile, ["balance", "remaining_balance", "remainingBalance", "quota", "quota_remaining", "quotaRemaining"])
        ?? pickNumber(user, ["balance", "remaining_balance", "remainingBalance", "quota", "quota_remaining", "quotaRemaining"])
        ?? pickNumber(dashboard, ["balance", "remaining_balance", "remainingBalance"]);
      const todaySpent = pickNumber(todayStats, [
        "today_actual_cost", "todayActualCost", "actual_cost", "actualCost",
        "today_cost", "todayCost", "today_amount", "todayAmount", "today_spent", "todaySpent",
        "cost", "amount", "spent", "usage_cost", "usageCost"
      ]) ?? pickNumber(dashboard, [
        "today_actual_cost", "todayActualCost", "actual_today_cost", "actualTodayCost",
        "today_cost", "todayCost", "today_amount", "todayAmount", "today_spent", "todaySpent"
      ]);
      const usageItems = listItems(todayUsage);
      const usageSpent = usageItems.reduce((sum, item) => sum + (pickNumber(item, ["actual_cost", "actualCost", "total_cost", "totalCost", "cost", "amount"]) || 0), 0);
      const summary = {
        todaySpent: todaySpent ?? usageSpent,
        remaining: remaining ?? 0,
        cachedAt: now()
      };
      const latest = getSession();
      if (latest) saveSession({ ...latest, user: profile || user || latest.user, billingSummary: summary });
      return summary;
    })().finally(() => { billingRefreshPromise = null; });
    return billingRefreshPromise;
  }
  function queueBillingRefresh(){
    refreshBillingSummary(false).catch((err) => console.warn("[ChainCloud] Failed to refresh billing summary", err));
  }
  let uiRenderTimer = null;
  function queueUiEnhancement(){
    replaceProviderLabel();
    clearTimeout(uiRenderTimer);
    uiRenderTimer = setTimeout(enhanceChainCloudUi, 30);
  }
  function replaceProviderLabel(){
    if (!document.body) return null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let found = null;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeValue && node.nodeValue.trim() === "OpenAI") {
        node.nodeValue = node.nodeValue.replace("OpenAI", "\u94fe\u8def\u4e91");
        found = node.parentElement || found;
      } else if (!found && node.nodeValue && node.nodeValue.trim() === "\u94fe\u8def\u4e91") {
        found = node.parentElement;
      }
    }
    return found;
  }
  function enhanceChainCloudUi(){
    replaceProviderLabel();
    if (isLoggedIn()) queueBillingRefresh();
  }
  function startUiEnhancer(){
    queueUiEnhancement();
    window.addEventListener("chaincloud-auth-changed", queueUiEnhancement);
    window.addEventListener("chaincloud-api-key-selected", queueUiEnhancement);
    const observer = new MutationObserver(queueUiEnhancement);
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true });
  }
  async function getUsageSummary(){ return request("/usage/dashboard/stats"); }
  async function getUsageStats(period){ return request("/usage/stats?period=" + encodeURIComponent(period || "today")); }
  async function getUsageByDateRange(startDate, endDate){
    return request("/usage?start_date=" + encodeURIComponent(startDate) + "&end_date=" + encodeURIComponent(endDate) + "&page=1&page_size=100");
  }
  function todayDateString(){
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }
  async function createPaymentOrder(amount, paymentType){
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) throw new Error("\u8bf7\u8f93\u5165\u6709\u6548\u7684\u5145\u503c\u91d1\u989d");
    const body = {
      amount: numericAmount,
      payment_type: paymentType || "alipay",
      order_type: "balance",
      is_mobile: false,
      payment_source: "hosted_redirect",
      return_url: ${JSON.stringify(`${CHAINCLOUD_ORIGIN}/payment/result`)}
    };
    return request("/payment/orders", { method: "POST", body });
  }
  async function createPaymentOrderWithFallback(amount){
    const methods = ["alipay", "alipay_direct", "wxpay", "wxpay_direct"];
    let lastError = null;
    for (const method of methods) {
      try { return await createPaymentOrder(amount, method); }
      catch (err) { lastError = err; }
    }
    throw lastError || new Error("\u521b\u5efa\u5145\u503c\u8ba2\u5355\u5931\u8d25");
  }
  async function pollPaymentOrder(orderId){
    return request("/payment/orders/" + encodeURIComponent(orderId));
  }
  function isPaidStatus(status){
    return ["COMPLETED", "PAID", "RECHARGING", "SUCCESS", "SUCCEEDED"].includes(String(status || "").trim().toUpperCase());
  }
  function isFinalFailedStatus(status){
    return ["EXPIRED", "CANCELLED", "CANCELED", "FAILED"].includes(String(status || "").trim().toUpperCase());
  }
  function qrImageUrl(value){
    if (!value) return "";
    if (/^data:image/i.test(value)) return value;
    if (/^https?:\\/\\/[^\\s]+\\.(png|jpe?g|webp|gif|svg)(\\?|#|$)/i.test(value)) return value;
    return "https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=" + encodeURIComponent(value);
  }
  function showRechargeDialog(){
    if (!isLoggedIn()) {
      showLoginModal();
      return null;
    }
    const existing = document.querySelector("[data-chaincloud-recharge-dialog]");
    existing?.remove();
    let pollTimer = null;
    const root = document.createElement("div");
    root.dataset.chaincloudRechargeDialog = "1";
    root.className = "text-token-foreground";
    root.style.cssText = "position:fixed!important;inset:0!important;z-index:2147483647!important;display:flex!important;align-items:center!important;justify-content:center!important;padding:24px!important;background:rgba(0,0,0,.55)!important;backdrop-filter:blur(6px)!important;pointer-events:auto!important;";
    root.innerHTML = '<div class="rounded-xl border border-token-border bg-token-main-surface-primary p-4 shadow-2xl" style="box-sizing:border-box;width:min(400px,100%);max-height:calc(100vh - 48px);overflow:auto;position:relative;z-index:2147483647"><div class="mb-3 flex items-start justify-between gap-3"><div><div class="text-base font-semibold">\u5145\u503c</div><div class="mt-1 text-sm text-token-description-foreground">\u5145\u503c\u5230\u94fe\u8def\u4e91\u8d26\u6237\u4f59\u989d</div></div><button type="button" data-close class="rounded-md px-2 py-1 text-token-description-foreground hover:bg-token-surface-hover hover:text-token-foreground" aria-label="\u5173\u95ed">\u00d7</button></div><div data-form-wrap><label class="mb-1 block text-sm text-token-description-foreground" for="chaincloud-recharge-amount">\u91d1\u989d</label><input id="chaincloud-recharge-amount" data-amount type="number" min="1" step="1" value="10" class="mb-3 h-10 w-full rounded-lg border border-token-border bg-token-input-background px-3 text-token-foreground outline-none focus:border-token-text-secondary" /><button type="button" data-pay class="mb-3 h-10 w-full rounded-full bg-token-foreground px-4 text-sm font-medium text-token-main-surface-primary disabled:opacity-60">\u4ed8\u6b3e</button></div><div data-error class="mb-3 hidden rounded-lg border border-token-error-border bg-token-error-background px-3 py-2 text-sm text-token-error-foreground"></div><div data-qr-wrap class="hidden flex-col items-center gap-3 rounded-lg border border-token-border bg-token-input-background p-4"><img data-qr alt="\u5145\u503c\u4e8c\u7ef4\u7801" class="h-[240px] w-[240px] rounded-md bg-white p-2" /><div data-status class="text-center text-sm text-token-description-foreground">\u8bf7\u626b\u7801\u5b8c\u6210\u652f\u4ed8\uff0c\u652f\u4ed8\u6210\u529f\u540e\u4f1a\u81ea\u52a8\u5173\u95ed</div><a data-open-pay href="#" target="_blank" rel="noopener noreferrer" class="hidden text-sm text-token-link-foreground">\u6253\u5f00\u652f\u4ed8\u9875</a></div></div>';
    const close = () => {
      if (pollTimer) window.clearInterval(pollTimer);
      root.remove();
    };
    const showError = (message) => {
      const error = root.querySelector("[data-error]");
      error.textContent = message || "\u64cd\u4f5c\u5931\u8d25";
      error.classList.remove("hidden");
    };
    root.querySelector("[data-close]")?.addEventListener("click", close);
    root.addEventListener("click", (event) => { if (event.target === root) close(); });
    root.querySelector("[data-pay]")?.addEventListener("click", async () => {
      const button = root.querySelector("[data-pay]");
      const amount = root.querySelector("[data-amount]")?.value;
      const error = root.querySelector("[data-error]");
      error?.classList.add("hidden");
      button.disabled = true;
      button.textContent = "\u521b\u5efa\u8ba2\u5355...";
      try {
        const order = await createPaymentOrderWithFallback(amount);
        const orderId = order?.order_id || order?.id;
        const qrValue = order?.qr_code || order?.qr || order?.qrcode || order?.code_url || order?.pay_url || order?.payment_url || order?.url || "";
        if (!orderId) throw new Error("\u5145\u503c\u8ba2\u5355\u65e0\u6548");
        const qr = root.querySelector("[data-qr]");
        const qrWrap = root.querySelector("[data-qr-wrap]");
        const status = root.querySelector("[data-status]");
        const openPay = root.querySelector("[data-open-pay]");
        root.querySelector("[data-form-wrap]")?.classList.add("hidden");
        const payUrl = order?.pay_url || order?.payment_url || order?.url || "";
        if (qrValue) qr.src = qrImageUrl(qrValue);
        else qr.classList.add("hidden");
        qr.addEventListener("error", () => {
          qr.classList.add("hidden");
          status.textContent = "\u4e8c\u7ef4\u7801\u52a0\u8f7d\u5931\u8d25\uff0c\u8bf7\u70b9\u51fb\u4e0b\u65b9\u652f\u4ed8\u94fe\u63a5";
        }, { once: true });
        if (payUrl) {
          openPay.href = payUrl;
          openPay.classList.remove("hidden");
        }
        qrWrap.classList.remove("hidden");
        qrWrap.classList.add("flex");
        button.textContent = "\u7b49\u5f85\u652f\u4ed8";
        pollTimer = window.setInterval(async () => {
          try {
            const latest = await pollPaymentOrder(orderId);
            if (isPaidStatus(latest?.status)) {
              status.textContent = "\u652f\u4ed8\u6210\u529f\uff0c\u6b63\u5728\u5237\u65b0\u4f59\u989d...";
              window.clearInterval(pollTimer);
              pollTimer = null;
              await refreshBillingSummary(true).catch(() => null);
              setTimeout(close, 600);
            } else if (isFinalFailedStatus(latest?.status)) {
              status.textContent = "\u8ba2\u5355\u5df2\u5931\u6548\uff0c\u8bf7\u91cd\u65b0\u53d1\u8d77\u5145\u503c";
              window.clearInterval(pollTimer);
              pollTimer = null;
              button.disabled = false;
              button.textContent = "\u91cd\u65b0\u4ed8\u6b3e";
            }
          } catch (err) {
            console.warn("[ChainCloud] Payment polling failed", err);
          }
        }, 3000);
      } catch (err) {
        showError(err?.message || String(err));
        button.disabled = false;
        button.textContent = "\u4ed8\u6b3e";
      }
    });
    document.body.appendChild(root);
    root.querySelector("[data-amount]")?.focus();
    return { close };
  }
  function loadTurnstileScript(){
    return new Promise((resolve, reject) => {
      if (window.turnstile) { resolve(window.turnstile); return; }
      let script = document.querySelector("script[data-chaincloud-turnstile]");
      if (!script) {
        script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.dataset.chaincloudTurnstile = "1";
        document.head.appendChild(script);
      }
      script.addEventListener("load", () => resolve(window.turnstile), { once: true });
      script.addEventListener("error", () => reject(new Error("Cloudflare verification failed to load")), { once: true });
    });
  }
  function showLoginModal(options){
    options = options || {};
    let cancelled = false;
    (async () => {
      try {
        const session = await loginWithSiteWindow();
        const key = await ensureDesktopApiKey();
        if (!cancelled) await options.onSuccess?.({ session, key });
      } catch (err) {
        if (!cancelled) {
          console.error("[ChainCloud] Login failed", err);
          await options.onError?.(err);
        }
      }
    })();
    return { close(){ cancelled = true; } };
  }
  async function logout(){
    const session = getSession();
    try {
      if (session?.refreshToken) {
        await request("/auth/logout", {
          method: "POST",
          auth: false,
          body: { refresh_token: session.refreshToken }
        });
      }
    } catch {}
    try { await window.electronBridge?.chaincloudSiteLogout?.(); } catch {}
    clearSession();
  }

  window.__chaincloudCodexAuth = {
    apiBase: API_BASE,
    storageKey: STORAGE_KEY,
    getSession,
    saveSession,
    clearSession,
    displayName,
    isLoggedIn,
    login,
    loginWithSiteWindow,
    completeSiteLogin,
    logout,
    getPublicSettings,
    refreshToken,
        refreshProfile,
        listKeys,
        ensureDesktopApiKey,
        switchDesktopApiKey,
        getUsageSummary,
        getUsageStats,
        refreshBillingSummary,
        queueBillingRefresh,
        billingPopoverText,
        showLoginModal,
        showRechargeDialog
  };
  window.dispatchEvent(new CustomEvent("chaincloud-auth-ready"));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startUiEnhancer, { once: true });
  else startUiEnhancer();
})();`;
}

function patchHtml(platform, isCheck) {
  const root = appRootFor(platform);
  const htmlPath = path.join(root, "webview", "index.html");
  if (!fs.existsSync(htmlPath)) return false;
  let html = read(htmlPath);
  let changed = false;

  if (!html.includes(`assets/${CLIENT_FILE}`)) {
    html = html.replace(
      /(<script type="module" crossorigin src="\.\/assets\/[^"]+"><\/script>)/,
      `<script src="./assets/${CLIENT_FILE}"></script>\n    $1`,
    );
    changed = true;
  }

  function ensureCspSource(directive, source) {
    const needle = `${directive} `;
    const start = html.indexOf(needle);
    if (start < 0) return;
    const end = html.indexOf("; ", start);
    const segmentEnd = end >= 0 ? end : html.indexOf('"', start);
    if (segmentEnd < 0) return;
    const segment = html.slice(start, segmentEnd);
    if (segment.split(/\s+/).includes(source)) return;
    html = html.slice(0, start + needle.length) + `${source} ` + html.slice(start + needle.length);
    changed = true;
  }

  ensureCspSource("connect-src", CHAINCLOUD_ORIGIN);
  ensureCspSource("connect-src", TURNSTILE_ORIGIN);
  ensureCspSource("script-src", TURNSTILE_ORIGIN);
  ensureCspSource("frame-src", CHAINCLOUD_ORIGIN);
  ensureCspSource("frame-src", TURNSTILE_ORIGIN);
  ensureCspSource("img-src", QR_IMAGE_ORIGIN);

  if (!isCheck && changed) write(htmlPath, html);
  return changed;
}

function installClient(platform, isCheck) {
  const root = appRootFor(platform);
  const assetsDir = path.join(root, "webview", "assets");
  const target = path.join(assetsDir, CLIENT_FILE);
  const source = jsClientSource();
  const changed = !fs.existsSync(target) || read(target) !== source;
  if (!isCheck && changed) write(target, source);
  return changed;
}

function patchPreload(platform, isCheck) {
  const root = appRootFor(platform);
  const preloadPath = path.join(root, ".vite", "build", "preload.js");
  if (!fs.existsSync(preloadPath)) return false;
  let source = read(preloadPath);
  if (source.includes("chaincloudRequest:") && source.includes("chaincloudSiteLogin:") && source.includes("chaincloudSiteLogout:")) return false;

  if (source.includes("chaincloudSiteLogin:") && source.includes("getSentryInitOptions")) {
    source = source.replace(
      /(chaincloudSiteLogin:async\(\)=>e\.ipcRenderer\.invoke\([^)]+\),)(getSentryInitOptions)/,
      `$1chaincloudSiteLogout:async()=>e.ipcRenderer.invoke(${JSON.stringify(CHAINCLOUD_LOGOUT_IPC_CHANNEL)}),$2`,
    );
    if (!isCheck) write(preloadPath, source);
    return true;
  }

  const needle = "triggerSentryTestError:async()=>{await e.ipcRenderer.invoke(l)},getSentryInitOptions";
  if (!source.includes(needle)) throw new Error("Unable to locate preload bridge object");
  source = source.replace(
    needle,
    `triggerSentryTestError:async()=>{await e.ipcRenderer.invoke(l)},chaincloudRequest:async t=>e.ipcRenderer.invoke(${JSON.stringify(CHAINCLOUD_IPC_CHANNEL)},t),chaincloudSiteLogin:async()=>e.ipcRenderer.invoke(${JSON.stringify(CHAINCLOUD_LOGIN_IPC_CHANNEL)}),chaincloudSiteLogout:async()=>e.ipcRenderer.invoke(${JSON.stringify(CHAINCLOUD_LOGOUT_IPC_CHANNEL)}),getSentryInitOptions`,
  );

  if (!isCheck) write(preloadPath, source);
  return true;
}

function patchMainProxy(platform, isCheck) {
  const root = appRootFor(platform);
  const mainDir = path.join(root, ".vite", "build");
  if (!fs.existsSync(mainDir)) return { file: null, changed: false };
  const candidates = fs
    .readdirSync(mainDir)
    .filter((file) => /^main-.*\.js$/.test(file))
    .map((file) => path.join(mainDir, file));
  if (candidates.length === 0) return { file: null, changed: false };
  const file = candidates[0];
  let source = read(file);
  const original = source;
  const marker = "var w=/^[a-z0-9-_]+$/i;";
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error("Unable to locate main bundle insertion point");
  const injectionStarts = [
    "var __chaincloudAuthIpcChannel=",
    "var __CHAINCLOUD_AUTH_PROXY_",
  ]
    .map((needle) => source.indexOf(needle))
    .filter((index) => index >= 0 && index < markerIndex);
  const stripStart = injectionStarts.length > 0 ? Math.min(...injectionStarts) : markerIndex;
  source = source.slice(0, stripStart) + source.slice(markerIndex);

  const proxy = `
var __CHAINCLOUD_AUTH_PROXY_V10__ = true;
var __chaincloudAuthIpcChannelV10 = ${JSON.stringify(CHAINCLOUD_IPC_CHANNEL)};
var __chaincloudLoginIpcChannelV10 = ${JSON.stringify(CHAINCLOUD_LOGIN_IPC_CHANNEL)};
var __chaincloudLogoutIpcChannelV10 = ${JSON.stringify(CHAINCLOUD_LOGOUT_IPC_CHANNEL)};
var __chaincloudLoginPartitionV10 = "chaincloud-login";
var __chaincloudLoginViewV10 = null;
var __chaincloudLoginPromiseV10 = null;
function __chaincloudReadSiteSessionV10(webContents) {
  return webContents.executeJavaScript(\`(() => {
    try {
      let access_token = localStorage.getItem("auth_token") || "";
      let refresh_token = localStorage.getItem("refresh_token") || "";
      let token_expires_at = localStorage.getItem("token_expires_at") || "";
      let auth_user = localStorage.getItem("auth_user") || "";
      return { access_token, refresh_token, token_expires_at: token_expires_at ? Number(token_expires_at) : 0, user: auth_user ? JSON.parse(auth_user) : null };
    } catch (error) {
      return { error: error && error.message || String(error) };
    }
  })()\`, true);
}
function __chaincloudRemoveHandlerV10(channel) {
  try { n.ipcMain.removeHandler(channel); } catch {}
}
async function __chaincloudClearLoginSessionV10() {
  try {
    let session = n.session.fromPartition(__chaincloudLoginPartitionV10);
    await session.clearStorageData();
    await session.clearCache?.();
  } catch {}
}
function __chaincloudSetLoginViewBoundsV10(parentWindow, loginView) {
  try {
    let size = parentWindow.getContentSize();
    loginView.setBounds({ x: 0, y: 0, width: size[0], height: size[1] });
    __chaincloudFitLoginPageV10(parentWindow, loginView);
  } catch {}
}
async function __chaincloudFitLoginPageV10(parentWindow, loginView) {
  try {
    let size = parentWindow.getContentSize();
    let scale = Math.min(1, Math.max(0.72, size[1] / 824));
    loginView.webContents.setZoomFactor(scale);
    await loginView.webContents.insertCSS([
      "html, body { width: 100% !important; height: 100% !important; overflow: hidden !important; }",
      "body > div:first-child { min-height: 100vh !important; height: 100vh !important; overflow: hidden !important; }",
      "* { scrollbar-width: none !important; }",
      "*::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }"
    ].join("\\n"));
  } catch {}
}
function __chaincloudDestroyLoginViewV10(parentWindow, loginView) {
  try { parentWindow?.removeBrowserView?.(loginView); } catch {}
  try { if (parentWindow?.getBrowserView?.() === loginView) parentWindow.setBrowserView(null); } catch {}
  try { loginView?.webContents?.destroy?.(); } catch {}
  if (__chaincloudLoginViewV10 === loginView) __chaincloudLoginViewV10 = null;
}
function __installChaincloudAuthProxyV10() {
  if (globalThis.__chaincloudAuthProxyV10Installed) return;
  globalThis.__chaincloudAuthProxyV10Installed = true;
  __chaincloudRemoveHandlerV10(__chaincloudAuthIpcChannelV10);
  __chaincloudRemoveHandlerV10(__chaincloudLoginIpcChannelV10);
  __chaincloudRemoveHandlerV10(__chaincloudLogoutIpcChannelV10);
  n.ipcMain.handle(__chaincloudAuthIpcChannelV10, async (event, request) => {
    if (request == null || typeof request !== "object") throw Error("Invalid ChainCloud request");
    let requestPath = String(request.path || "");
    if (!requestPath.startsWith("/") || requestPath.startsWith("//")) throw Error("Invalid ChainCloud path");
    let url = new URL(${JSON.stringify(CHAINCLOUD_API_BASE)} + requestPath);
    if (url.origin !== ${JSON.stringify(CHAINCLOUD_ORIGIN)} || !url.pathname.startsWith("/api/v1/")) throw Error("Blocked ChainCloud URL");
    let method = String(request.method || "GET").toUpperCase();
    let headers = {};
    for (let [key, value] of Object.entries(request.headers || {})) {
      let lower = key.toLowerCase();
      if (lower === "content-type" || lower === "authorization" || lower === "accept-language") headers[key] = String(value);
    }
    let init = { method, headers };
    if (request.body != null) init.body = String(request.body);
    let response = await n.net.fetch(url.toString(), init);
    let text = await response.text();
    return { ok: response.ok, status: response.status, statusText: response.statusText, text };
  });
  n.ipcMain.handle(__chaincloudLogoutIpcChannelV10, async () => {
    await __chaincloudClearLoginSessionV10();
    return true;
  });
  n.ipcMain.handle(__chaincloudLoginIpcChannelV10, async (event) => {
    if (__chaincloudLoginViewV10 && !__chaincloudLoginViewV10.webContents?.isDestroyed?.()) {
      try { __chaincloudLoginViewV10.webContents.focus(); } catch {}
      return __chaincloudLoginPromiseV10;
    }
    __chaincloudLoginPromiseV10 = new Promise(async (resolve, reject) => {
    await __chaincloudClearLoginSessionV10();
    let parentWindow = n.BrowserWindow.fromWebContents(event.sender);
    if (!parentWindow) throw Error("ChainCloud login parent window unavailable");
    let previousTitle = "";
    try { previousTitle = parentWindow.getTitle?.() || ""; parentWindow.setTitle?.("Login - ChainCloud"); } catch {}
    let loginView = new n.BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: __chaincloudLoginPartitionV10,
      },
    });
    __chaincloudLoginViewV10 = loginView;
    let done = false;
    let pollTimer = null;
    let resizeHandler = () => __chaincloudSetLoginViewBoundsV10(parentWindow, loginView);
    let cleanup = () => {
      try {
        parentWindow.off?.("resize", resizeHandler);
        parentWindow.off?.("closed", parentClosedHandler);
      } catch {}
      if (pollTimer) clearInterval(pollTimer);
      __chaincloudDestroyLoginViewV10(parentWindow, loginView);
      try { if (previousTitle) parentWindow.setTitle?.(previousTitle); } catch {}
      if (__chaincloudLoginPromiseV10) __chaincloudLoginPromiseV10 = null;
    };
    let parentClosedHandler = () => {
      done = true;
      cleanup();
      reject(Error("ChainCloud login cancelled"));
    };
    let checkSession = async () => {
      if (done || loginView.webContents.isDestroyed()) return;
      let sessionData;
      try { sessionData = await __chaincloudReadSiteSessionV10(loginView.webContents); } catch { return; }
      if (sessionData?.access_token) {
        done = true;
        cleanup();
        resolve(sessionData);
      }
    };
    parentWindow.setBrowserView(loginView);
    resizeHandler();
    parentWindow.on?.("resize", resizeHandler);
    parentWindow.on?.("closed", parentClosedHandler);
    loginView.webContents.on("dom-ready", async () => { await __chaincloudFitLoginPageV10(parentWindow, loginView); await checkSession(); });
    loginView.webContents.on("did-finish-load", async () => { await __chaincloudFitLoginPageV10(parentWindow, loginView); await checkSession(); });
    loginView.webContents.on("did-navigate", async () => { await __chaincloudFitLoginPageV10(parentWindow, loginView); await checkSession(); });
    loginView.webContents.on("did-navigate-in-page", async () => { await __chaincloudFitLoginPageV10(parentWindow, loginView); await checkSession(); });
    pollTimer = setInterval(checkSession, 1000);
    pollTimer.unref?.();
    loginView.webContents.loadURL(${JSON.stringify(CHAINCLOUD_ORIGIN + "/login")}).catch((error) => {
      done = true;
      cleanup();
      reject(error);
    });
    });
    return __chaincloudLoginPromiseV10;
  });
}
__installChaincloudAuthProxyV10();
`;
  const existingInjection = injectionStarts.length > 0 ? original.slice(stripStart, markerIndex) : "";
  if (existingInjection.replace(/\s+/g, "") === proxy.replace(/\s+/g, "")) {
    return { file, changed: false };
  }
  source = source.replace(marker, proxy + marker);

  const changed = source !== original;
  if (!isCheck && changed) write(file, source);
  return { file, changed };
}

function findLoginBundle(platform) {
  const root = appRootFor(platform);
  const assetsDir = path.join(root, "webview", "assets");
  for (const file of fs.readdirSync(assetsDir)) {
    if (!/^login-route-.*\.js$/.test(file)) continue;
    const full = path.join(assetsDir, file);
    const source = read(full);
    if (source.includes("login-with-api-key") && source.includes("LoginRoute")) return full;
  }
  return null;
}

function matchOne(source, regex, label) {
  const match = source.match(regex);
  if (!match) throw new Error(`Unable to locate ${label}`);
  return match;
}

function patchLoginRoute(platform, isCheck) {
  const file = findLoginBundle(platform);
  if (!file) return { file: null, changed: false };
  let source = read(file);
  if (source.includes("__CHAINCLOUD_NATIVE_LOGIN_V9__")) return { file, changed: false };

  const react = source.match(/var\s+\w+=h\(\),(\w+)=e\(o\(\),1\),(\w+)=s\(\);/)
    || source.match(/var\s+\w+=_\(\),(\w+)=e\(s\(\),1\),(\w+)=c\(\);/);
  if (!react) throw new Error("Unable to locate React/jsx aliases");
  const reactName = react[1];
  const jsxName = react[2];
  const authHook = matchOne(source, /import\{[^}]*t as (\w+)[^}]*\}from"\.\/use-auth-[^"]+\.js"/, "use-auth hook")[1];
  const apiKeyLogin = matchOne(source, /await\s+(\w+)\(`login-with-api-key`,\{hostId:(\w+),apiKey:[^}]+}\)/, "API key login call");
  const requestFn = apiKeyLogin[1];
  const hostId = apiKeyLogin[2];
  const navigateHook = matchOne(source, /import\{f as (\w+)\}from"\.\/chunk-[^"]+\.js"/, "navigate hook")[1];

  const component = `
function ChainCloudLoginRoute(){let ccJsx=${jsxName},ccAuth=${authHook}(),ccNavigate=${navigateHook}(),[ccState,ccSetState]=${reactName}.useState("opening"),[ccAttempt,ccSetAttempt]=${reactName}.useState(0);${reactName}.useEffect(()=>{let ccCancelled=!1,ccTimer=null,ccStart=async()=>{if(ccCancelled)return;let ccBridge=window.electronBridge?.chaincloudSiteLogin,ccApi=window.__chaincloudCodexAuth;if(typeof ccBridge!=="function"||!ccApi?.completeSiteLogin||!ccApi?.ensureDesktopApiKey){ccTimer=setTimeout(ccStart,200);return}try{let ccSession=await ccBridge();if(ccCancelled)return;await ccApi.completeSiteLogin(ccSession);let ccKey=await ccApi.ensureDesktopApiKey();if(ccCancelled)return;await ${requestFn}("login-with-api-key",{hostId:${hostId},apiKey:ccKey.key});ccAuth.setAuthMethod("apikey");ccNavigate("/welcome",{replace:!0})}catch(ccErr){if(!ccCancelled){console.error("[ChainCloud] native login failed",ccErr);ccSetState("error")}}};ccStart();return()=>{ccCancelled=!0;ccTimer&&clearTimeout(ccTimer)}},[ccAttempt]);let ccRetry=()=>{ccSetState("opening");ccSetAttempt(ccValue=>ccValue+1)};return ccJsx.jsx("div",{"data-chaincloud-login":"__CHAINCLOUD_NATIVE_LOGIN_V9__",className:"fixed inset-0 flex items-center justify-center bg-token-main-surface-primary px-4 text-token-foreground",children:ccJsx.jsxs("div",{className:"flex w-full max-w-[360px] flex-col items-center gap-4 text-center",children:[ccJsx.jsx("div",{className:"text-base font-semibold",children:"\\u6b63\\u5728\\u6253\\u5f00\\u94fe\\u8def\\u4e91\\u767b\\u5f55"}),ccJsx.jsx("div",{className:"text-sm text-token-description-foreground",children:ccState==="error"?"\\u767b\\u5f55\\u7a97\\u53e3\\u5df2\\u5173\\u95ed\\u6216\\u767b\\u5f55\\u5931\\u8d25":"\\u8bf7\\u5728\\u5f39\\u51fa\\u7684\\u7ad9\\u70b9\\u9875\\u9762\\u4e2d\\u5b8c\\u6210\\u9a8c\\u8bc1\\u548c\\u767b\\u5f55"}),ccState==="error"?ccJsx.jsx("button",{type:"button",className:"h-10 rounded-full bg-token-foreground px-5 text-sm font-medium text-token-main-surface-primary",onClick:ccRetry,children:"\\u91cd\\u65b0\\u6253\\u5f00\\u767b\\u5f55"}):null]})})}
`;

  if (source.includes("function ChainCloudLoginRoute")) {
    const start = source.indexOf("function ChainCloudLoginRoute");
    const exportStart = source.indexOf("export{ChainCloudLoginRoute as LoginRoute};", start);
    if (start < 0 || exportStart < 0) throw new Error("Unable to locate ChainCloudLoginRoute export");
    const exportEnd = exportStart + "export{ChainCloudLoginRoute as LoginRoute};".length;
    source = source.slice(0, start) + component + "export{ChainCloudLoginRoute as LoginRoute};" + source.slice(exportEnd);
  } else {
    const exportMatch = matchOne(source, /export\{(\w+) as LoginRoute\};/, "LoginRoute export");
    const exportName = exportMatch[1];
    const start = source.indexOf(`function ${exportName}()`);
    const exportStart = source.indexOf(exportMatch[0], start);
    if (start < 0 || exportStart < 0) throw new Error("Unable to locate LoginRoute function");
    const exportEnd = exportStart + exportMatch[0].length;
    source = source.slice(0, start) + component + "export{ChainCloudLoginRoute as LoginRoute};" + source.slice(exportEnd);
  }

  if (!isCheck) write(file, source);
  return { file, changed: true };
}

function patchProfileBundleFile(file, isCheck) {
  let source = read(file);
  const original = source;
  let changed = false;
  if (!source.includes("codex.profileDropdown.apiKeyAuth") && !source.includes("chaincloud-auth")) return false;

  const originalApiKeyRow = /else if\(x\)\{let e;t\[87\]===Symbol\.for\(`react\.memo_cache_sentinel`\)\?\(e=\(0,Q\.jsx\)\(jo,\{LeftIcon:Yu,disabled:!0,children:\(0,Q\.jsx\)\(X,\{id:`codex\.profileDropdown\.apiKeyAuth`,defaultMessage:`Logged in with API key`,description:`Label indicating the user is authenticated with an API key`\}\)\},`api-key-auth`\),t\[87\]=e\):e=t\[87\],De\.push\(e\)\}/;
  if (originalApiKeyRow.test(source)) {
    source = source.replace(
      originalApiKeyRow,
      "else if(x){let e,n=window.__chaincloudCodexAuth?.displayName?.()||``;n&&(e=(0,Q.jsx)(jo,{LeftIcon:Yu,disabled:!0,children:n},`chaincloud-auth`),De.push(e))}",
    );
    changed = true;
  }

  const oldChaincloudApiKeyRow = /else if\(x\)\{let e,n=window\.__chaincloudCodexAuth\?\.displayName\?\.\(\)\|\|``;n&&\(e=\(0,Q\.jsx\)\(jo,\{LeftIcon:Yu,disabled:!0,children:n\},`chaincloud-auth`\),De\.push\(e\)\)\}/;
  if (oldChaincloudApiKeyRow.test(source)) {
    source = source.replace(
      oldChaincloudApiKeyRow,
      "else if(x){let e,n=window.__chaincloudCodexAuth?.displayName?.()||``;n&&(e=(0,Q.jsx)(jo,{LeftIcon:Yu,disabled:!0,children:n},`chaincloud-auth`),De.push(e))}",
    );
    changed = true;
  }

  const billingApiKeyRow = /else if\(x\)\{let e,n=window\.__chaincloudCodexAuth\?\.displayName\?\.\(\)\|\|``,r=window\.__chaincloudCodexAuth\?\.billingText\?\.\(\)\|\|``;n&&\(e=\(0,Q\.jsxs\)\(Q\.Fragment,\{children:\[\(0,Q\.jsx\)\(jo,\{LeftIcon:Yu,disabled:!0,children:n\},`chaincloud-auth`\),r\?\(0,Q\.jsx\)\(jo,\{disabled:!0,children:r\},`chaincloud-billing`\):null\]\}\),De\.push\(e\)\)\}/;
  if (billingApiKeyRow.test(source)) {
    source = source.replace(
      billingApiKeyRow,
      "else if(x){let e,n=window.__chaincloudCodexAuth?.displayName?.()||``;n&&(e=(0,Q.jsx)(jo,{LeftIcon:Yu,disabled:!0,children:n},`chaincloud-auth`),De.push(e))}",
    );
    changed = true;
  }

  const profileDropdownApiKeyRow = /else if\(D\)\{let e;t\[87\]===Symbol\.for\(`react\.memo_cache_sentinel`\)\?\(e=\(0,Z\.jsx\)\(K,\{LeftIcon:Qe,disabled:!0,children:\(0,Z\.jsx\)\(C,\{id:`codex\.profileDropdown\.apiKeyAuth`,defaultMessage:`Logged in with API key`,description:`Label indicating the user is authenticated with an API key`\}\)\},`api-key-auth`\),t\[87\]=e\):e=t\[87\],Q\.push\(e\)\}/;
  if (profileDropdownApiKeyRow.test(source)) {
    source = source.replace(
      profileDropdownApiKeyRow,
      "else if(D){let e,n=window.__chaincloudCodexAuth?.displayName?.()||``;n&&(e=(0,Z.jsx)(K,{LeftIcon:Qe,disabled:!0,children:n},`chaincloud-auth`),Q.push(e))}",
    );
    changed = true;
  }

  const logoutFn = /Ce=async\(\)=>\{await vi\(r,`use-copilot-auth-if-available`,!1\),await zt\(`logout`,\{hostId:Wr\}\),s\(`\/login`\)\}/;
  if (logoutFn.test(source) && !source.includes("chaincloudCodexAuth?.logout")) {
    source = source.replace(
      logoutFn,
      "Ce=async()=>{await window.__chaincloudCodexAuth?.logout?.(),await vi(r,`use-copilot-auth-if-available`,!1),await zt(`logout`,{hostId:Wr})}",
    );
    changed = true;
  }
  const oldChaincloudLogoutFn = /Ce=async\(\)=>\{await window\.__chaincloudCodexAuth\?\.logout\?\.\(\),await vi\(r,`use-copilot-auth-if-available`,!1\),await zt\(`logout`,\{hostId:Wr\}\),s\(`\/login`\)\}/;
  if (oldChaincloudLogoutFn.test(source)) {
    source = source.replace(
      oldChaincloudLogoutFn,
      "Ce=async()=>{await window.__chaincloudCodexAuth?.logout?.(),await vi(r,`use-copilot-auth-if-available`,!1),await zt(`logout`,{hostId:Wr})}",
    );
    changed = true;
  }

  const profileDropdownLogoutFn = /bt=async\(\)=>\{await o\(i,`use-copilot-auth-if-available`,!1\),await _\(`logout`,\{hostId:f\}\),u\(`\/login`\)\}/;
  if (profileDropdownLogoutFn.test(source) && !source.includes("bt=async()=>{await window.__chaincloudCodexAuth?.logout")) {
    source = source.replace(
      profileDropdownLogoutFn,
      "bt=async()=>{await window.__chaincloudCodexAuth?.logout?.(),await o(i,`use-copilot-auth-if-available`,!1),await _(`logout`,{hostId:f})}",
    );
    changed = true;
  }

  const logoutRow = /Be=f&&\(0,Q\.jsx\)\(jo,\{onClick:\(\)=>\{o\(!1\),Ha\(r,rd,\{onConfirm:we\}\)\},LeftIcon:Qs,children:\(0,Q\.jsx\)\(X,\{id:`codex\.profileDropdown\.logOut`,defaultMessage:`Log out`,description:`Menu item to log out of ChatGPT`\}\)\}\)/;
  if (logoutRow.test(source) && !source.includes("chaincloud-login-profile")) {
    source = source.replace(
      logoutRow,
      "Be=(window.__chaincloudCodexAuth?.isLoggedIn?.()?f:!0)&&(0,Q.jsx)(jo,{onClick:()=>{o(!1),window.__chaincloudCodexAuth?.isLoggedIn?.()?Ha(r,rd,{onConfirm:we}):window.__chaincloudCodexAuth?.showLoginModal?.({onSuccess:async({key:e})=>{await zt(`login-with-api-key`,{hostId:Wr,apiKey:e.key}),h(`apikey`)}})},LeftIcon:Qs,children:window.__chaincloudCodexAuth?.isLoggedIn?.()?(0,Q.jsx)(X,{id:`codex.profileDropdown.logOut`,defaultMessage:`Log out`,description:`Menu item to log out of ChatGPT`}):`\u767b\u5f55`},`chaincloud-login-profile`)",
    );
    changed = true;
  }

  const loginRow = /Be=\(window\.__chaincloudCodexAuth\?\.isLoggedIn\?\.\(\)\?f:!0\)&&\(0,Q\.jsx\)\(jo,\{onClick:\(\)=>\{o\(!1\),window\.__chaincloudCodexAuth\?\.isLoggedIn\?\.\(\)\?Ha\(r,rd,\{onConfirm:we\}\):window\.__chaincloudCodexAuth\?\.showLoginModal\?\.\(\{onSuccess:async\(\{key:e\}\)=>\{await zt\(`login-with-api-key`,\{hostId:Wr,apiKey:e\.key\}\),h\(`apikey`\)\}\}\)\},LeftIcon:Qs,children:window\.__chaincloudCodexAuth\?\.isLoggedIn\?\.\(\)\?\(0,Q\.jsx\)\(X,\{id:`codex\.profileDropdown\.logOut`,defaultMessage:`Log out`,description:`Menu item to log out of ChatGPT`\}\):`[^`]*`\},`chaincloud-login-profile`\)/;
  if (loginRow.test(source) && !source.includes("chaincloud-recharge-profile")) {
    source = source.replace(
      loginRow,
      "Be=(0,Q.jsxs)(Q.Fragment,{children:[window.__chaincloudCodexAuth?.isLoggedIn?.()?(0,Q.jsx)(jo,{onClick:()=>{o(!1),window.__chaincloudCodexAuth?.showRechargeDialog?.()},LeftIcon:Xu,children:`\u5145\u503c`},`chaincloud-recharge-profile`):null,(window.__chaincloudCodexAuth?.isLoggedIn?.()?f:!0)&&(0,Q.jsx)(jo,{onClick:()=>{o(!1),window.__chaincloudCodexAuth?.isLoggedIn?.()?Ha(r,rd,{onConfirm:we}):window.__chaincloudCodexAuth?.showLoginModal?.({onSuccess:async({key:e})=>{await zt(`login-with-api-key`,{hostId:Wr,apiKey:e.key}),h(`apikey`)}})},LeftIcon:Qs,children:window.__chaincloudCodexAuth?.isLoggedIn?.()?(0,Q.jsx)(X,{id:`codex.profileDropdown.logOut`,defaultMessage:`Log out`,description:`Menu item to log out of ChatGPT`}):`\u767b\u5f55`},`chaincloud-login-profile`)]})",
    );
    changed = true;
  }

  const signInOpenAiRow = /if\(ve\)\{let e;t\[105\]!==u\|\|t\[106\]!==c\?\(e=\(\)=>\{c\(!1\),u\(`\/login`\)\},t\[105\]=u,t\[106\]=c,t\[107\]=e\):e=t\[107\];let n;t\[108\]===Symbol\.for\(`react\.memo_cache_sentinel`\)\?\(n=\(0,Z\.jsx\)\(C,\{id:`codex\.profileDropdown\.signInWithOpenAI`,defaultMessage:`Sign in with ChatGPT`,description:`Profile menu item to sign in with ChatGPT`\}\),t\[108\]=n\):n=t\[108\];let r;t\[109\]===e\?r=t\[110\]:\(r=\(0,Z\.jsx\)\(K,\{onClick:e,LeftIcon:Ge,children:n\},`sign-in-openai`\),t\[109\]=e,t\[110\]=r\),Q\.push\(r\)\}/;
  if (signInOpenAiRow.test(source) && !source.includes("chaincloud-login-profile")) {
    source = source.replace(
      signInOpenAiRow,
      "if(ve){let e;t[105]!==c||t[106]!==f||t[107]!==y?(e=()=>{c(!1),window.__chaincloudCodexAuth?.showLoginModal?.({onSuccess:async({key:e})=>{await _(`login-with-api-key`,{hostId:f,apiKey:e.key}),y(`apikey`)}})},t[105]=c,t[106]=f,t[107]=y,t[108]=e):e=t[108];let r;t[109]===e?r=t[110]:(r=(0,Z.jsx)(K,{onClick:e,LeftIcon:Ge,children:`\u767b\u5f55`},`chaincloud-login-profile`),t[109]=e,t[110]=r),Q.push(r)}",
    );
    changed = true;
  }

  if (source.includes("profile-dropdown") && !source.includes("chaincloud-recharge-profile")) {
    const rechargeNeedle = "let Ft;t[147]!==xt||t[148]!==g||t[149]!==i||t[150]!==c?(Ft=g&&(0,Z.jsx)(K,{onClick:()=>{c(!1),be(i,Jt,{onConfirm:xt})},LeftIcon:Ze,children:(0,Z.jsx)(C,{id:`codex.profileDropdown.logOut`,defaultMessage:`Log out`,description:`Menu item to log out of ChatGPT`})}),t[147]=xt,t[148]=g,t[149]=i,t[150]=c,t[151]=Ft):Ft=t[151];";
    const rechargeReplacement =
      rechargeNeedle +
      "let Rt=window.__chaincloudCodexAuth?.isLoggedIn?.()?(0,Z.jsx)(K,{LeftIcon:Ue,onClick:()=>{c(!1),window.__chaincloudCodexAuth?.showRechargeDialog?.()},children:`\u5145\u503c`},`chaincloud-recharge-profile`):null;";
    if (source.includes(rechargeNeedle)) {
      source = source.replace(rechargeNeedle, rechargeReplacement);
      source = source.replace(
        "t[157]!==Nt||t[158]!==Pt||t[159]!==Ft?(It=(0,Z.jsxs)(`div`,{className:`flex w-full min-w-0 flex-col gap-0`,children:[Q,$,Et,kt,At,Nt,Pt,Ft]}),t[152]=Q,t[153]=$,t[154]=Et,t[155]=kt,t[156]=At,t[157]=Nt,t[158]=Pt,t[159]=Ft,t[160]=It):It=t[160];",
        "t[157]!==Nt||t[158]!==Pt||t[159]!==Ft||t[166]!==Rt?(It=(0,Z.jsxs)(`div`,{className:`flex w-full min-w-0 flex-col gap-0`,children:[Q,$,Et,kt,At,Nt,Pt,Rt,Ft]}),t[152]=Q,t[153]=$,t[154]=Et,t[155]=kt,t[156]=At,t[157]=Nt,t[158]=Pt,t[159]=Ft,t[166]=Rt,t[160]=It):It=t[160];",
      );
      changed = true;
    }
  }

  changed = changed && source !== original;
  if (!isCheck && changed) write(file, source);
  return changed;
}

function patchProfileBundles(platform, isCheck) {
  const root = appRootFor(platform);
  const assetsDir = path.join(root, "webview", "assets");
  const touched = [];
  for (const file of fs.readdirSync(assetsDir)) {
    if (!file.endsWith(".js")) continue;
    const full = path.join(assetsDir, file);
    const source = read(full);
    if (!source.includes("codex.profileDropdown.apiKeyAuth") && !source.includes("chaincloud-auth")) continue;
    if (patchProfileBundleFile(full, isCheck)) touched.push(full);
  }
  return touched;
}

function patchComposerBundles(platform, isCheck) {
  const root = appRootFor(platform);
  const assetsDir = path.join(root, "webview", "assets");
  if (!fs.existsSync(assetsDir)) return [];
  const touched = [];
  for (const name of fs.readdirSync(assetsDir)) {
    if (!/^composer-(?!atoms-).*\.js$/.test(name)) continue;
    const file = path.join(assetsDir, name);
    let source = read(file);
    let changed = false;
    if (source.includes("ChainCloudInlineBilling")) {
      const helperStart = source.indexOf("function ChainCloudInlineBilling()");
      const helperEnd = helperStart >= 0 ? source.indexOf("function ", helperStart + 1) : -1;
      if (helperStart >= 0 && helperEnd > helperStart) {
        source = source.slice(0, helperStart) + source.slice(helperEnd);
        changed = true;
      }
      if (source.includes(",(0,Q.jsx)(ChainCloudInlineBilling,{})")) {
        source = source.replaceAll(",(0,Q.jsx)(ChainCloudInlineBilling,{})", "");
        changed = true;
      }
    }
    if (!source.includes("__chaincloudCodexSwitchApiKey")) {
      const needle = "let k=O,A=o?.authMethod===`copilot`,";
      if (source.includes(needle)) {
        const replacement =
          "let k=O;window.__chaincloudCodexSwitchApiKey=async e=>{await er(`login-with-api-key`,{hostId:a.hostId,apiKey:e})};let A=o?.authMethod===`copilot`,";
        source = source.replace(needle, replacement);
        changed = true;
      }
    }
    const providerNeedle = "let t=e.model_provider;if(t==null||t.length===0)return null;";
    if (source.includes(providerNeedle) && !source.includes("t===`openai`)return `\u94fe\u8def\u4e91`")) {
      source = source.replace(
        providerNeedle,
        "let t=e.model_provider;if(t==null||t.length===0)return null;if(t===`openai`)return `\u94fe\u8def\u4e91`;",
      );
      changed = true;
    }
    const providerButtonNeedle = "function Wm(e){let t=(0,$.c)(5),{name:n}=e,r;";
    if (source.includes(providerButtonNeedle) && !source.includes("n=n===`OpenAI`?`\u94fe\u8def\u4e91`:n")) {
      source = source.replace(
        providerButtonNeedle,
        "function Wm(e){let t=(0,$.c)(5),{name:n}=e;n=n===`OpenAI`?`\u94fe\u8def\u4e91`:n;let r;",
      );
      changed = true;
    }
    if (changed) {
      if (!isCheck) write(file, source);
      touched.push(file);
    }
  }
  return touched;
}

function patchLocalThreadBundles(platform, isCheck) {
  const root = appRootFor(platform);
  const assetsDir = path.join(root, "webview", "assets");
  if (!fs.existsSync(assetsDir)) return [];
  const touched = [];
  for (const name of fs.readdirSync(assetsDir)) {
    if (!/^local-conversation-thread-.*\.js$/.test(name)) continue;
    const file = path.join(assetsDir, name);
    let source = read(file);
    const original = source;
    let changed = false;

    if (!source.includes("ChainCloudContextBilling") && source.includes("codex.localConversation.status.contextUsageTooltip")) {
      const helper =
        "function ChainCloudContextBilling(){let e=(0,Z.c)(5),[t,n]=(0,Q.useState)(window.__chaincloudCodexAuth?.billingPopoverText?.()||`\u4eca\u65e5\u6d88\u8d39 --\\n\u5269\u4f59\u91d1\u989d --`),r;e[0]===Symbol.for(`react.memo_cache_sentinel`)?(r=()=>{let e=!0;window.__chaincloudCodexAuth?.refreshBillingSummary?.(!0).then(()=>{e&&n(window.__chaincloudCodexAuth?.billingPopoverText?.()||`\u4eca\u65e5\u6d88\u8d39 --\\n\u5269\u4f59\u91d1\u989d --`)}).catch(()=>{e&&n(window.__chaincloudCodexAuth?.billingPopoverText?.()||`\u4eca\u65e5\u6d88\u8d39 --\\n\u5269\u4f59\u91d1\u989d --`)});let t=()=>{e&&n(window.__chaincloudCodexAuth?.billingPopoverText?.()||`\u4eca\u65e5\u6d88\u8d39 --\\n\u5269\u4f59\u91d1\u989d --`)};return window.addEventListener(`chaincloud-auth-changed`,t),window.addEventListener(`chaincloud-api-key-selected`,t),()=>{e=!1,window.removeEventListener(`chaincloud-auth-changed`,t),window.removeEventListener(`chaincloud-api-key-selected`,t)}},e[0]=r):r=e[0],(0,Q.useEffect)(r,[]);let i;e[1]!==t?(i=(0,$.jsx)(`div`,{className:`mt-2 whitespace-pre-line border-t border-token-border pt-2 text-center font-medium leading-snug`,children:t}),e[1]=t,e[2]=i):i=e[2];return i}";
      const functionIndex = source.indexOf("function mu(e)");
      if (functionIndex >= 0) {
        source = source.slice(0, functionIndex) + helper + source.slice(functionIndex);
        changed = true;
      }
    }

    const tooltipNeedle = "D=(0,$.jsx)(Tn,{side:`left`,tooltipContent:p,children:E})";
    if (source.includes(tooltipNeedle) && source.includes("ChainCloudContextBilling")) {
      source = source.replace(
        tooltipNeedle,
        "D=(0,$.jsx)(Tn,{side:`left`,tooltipContent:p?(0,$.jsxs)($.Fragment,{children:[p,(0,$.jsx)(ChainCloudContextBilling,{})]}):(0,$.jsx)(ChainCloudContextBilling,{}),children:E})",
      );
      changed = true;
    }

    const billingApiKeyRow = /else if\(x\)\{let e,n=window\.__chaincloudCodexAuth\?\.displayName\?\.\(\)\|\|``,r=window\.__chaincloudCodexAuth\?\.billingText\?\.\(\)\|\|``;n&&\(e=\(0,Q\.jsxs\)\(Q\.Fragment,\{children:\[\(0,Q\.jsx\)\(jo,\{LeftIcon:Yu,disabled:!0,children:n\},`chaincloud-auth`\),r\?\(0,Q\.jsx\)\(jo,\{disabled:!0,children:r\},`chaincloud-billing`\):null\]\}\),De\.push\(e\)\)\}/;
    if (billingApiKeyRow.test(source)) {
      source = source.replace(
        billingApiKeyRow,
        "else if(x){let e,n=window.__chaincloudCodexAuth?.displayName?.()||``;n&&(e=(0,Q.jsx)(jo,{LeftIcon:Yu,disabled:!0,children:n},`chaincloud-auth`),De.push(e))}",
      );
      changed = true;
    }

    const loginRow = /Be=\(window\.__chaincloudCodexAuth\?\.isLoggedIn\?\.\(\)\?f:!0\)&&\(0,Q\.jsx\)\(jo,\{onClick:\(\)=>\{o\(!1\),window\.__chaincloudCodexAuth\?\.isLoggedIn\?\.\(\)\?Ha\(r,rd,\{onConfirm:we\}\):window\.__chaincloudCodexAuth\?\.showLoginModal\?\.\(\{onSuccess:async\(\{key:e\}\)=>\{await zt\(`login-with-api-key`,\{hostId:Wr,apiKey:e\.key\}\),h\(`apikey`\)\}\}\)\},LeftIcon:Qs,children:window\.__chaincloudCodexAuth\?\.isLoggedIn\?\.\(\)\?\(0,Q\.jsx\)\(X,\{id:`codex\.profileDropdown\.logOut`,defaultMessage:`Log out`,description:`Menu item to log out of ChatGPT`\}\):`[^`]*`\},`chaincloud-login-profile`\)/;
    if (loginRow.test(source) && !source.includes("chaincloud-recharge-profile")) {
      source = source.replace(
        loginRow,
        "Be=(0,Q.jsxs)(Q.Fragment,{children:[window.__chaincloudCodexAuth?.isLoggedIn?.()?(0,Q.jsx)(jo,{onClick:()=>{o(!1),window.__chaincloudCodexAuth?.showRechargeDialog?.()},LeftIcon:Xu,children:`\u5145\u503c`},`chaincloud-recharge-profile`):null,(window.__chaincloudCodexAuth?.isLoggedIn?.()?f:!0)&&(0,Q.jsx)(jo,{onClick:()=>{o(!1),window.__chaincloudCodexAuth?.isLoggedIn?.()?Ha(r,rd,{onConfirm:we}):window.__chaincloudCodexAuth?.showLoginModal?.({onSuccess:async({key:e})=>{await zt(`login-with-api-key`,{hostId:Wr,apiKey:e.key}),h(`apikey`)}})},LeftIcon:Qs,children:window.__chaincloudCodexAuth?.isLoggedIn?.()?(0,Q.jsx)(X,{id:`codex.profileDropdown.logOut`,defaultMessage:`Log out`,description:`Menu item to log out of ChatGPT`}):`\u767b\u5f55`},`chaincloud-login-profile`)]})",
      );
      changed = true;
    }

    changed = changed && source !== original;
    if (changed) {
      if (!isCheck) write(file, source);
      touched.push(file);
    }
  }
  return touched;
}

function patchAgentSettingsBundle(platform, isCheck) {
  const root = appRootFor(platform);
  const assetsDir = path.join(root, "webview", "assets");
  if (!fs.existsSync(assetsDir)) return { file: null, changed: false };
  const fileName = fs.readdirSync(assetsDir).find((name) => /^agent-settings-.*\.js$/.test(name));
  if (!fileName) return { file: null, changed: false };
  const file = path.join(assetsDir, fileName);
  let source = read(file);
  if (source.includes("function ChainCloudApiKeySettingsRow()")) return { file, changed: false };

  const reactHookMatch = source.match(/var\s+(\w+)=y\(\),(\w+)=e\(s\(\),1\);/) || source.match(/var\s+(\w+)=_\(\),(\w+)=e\(s\(\),1\);/);
  if (!reactHookMatch) throw new Error("Unable to locate AgentSettings React aliases");
  const memoCache = reactHookMatch[1];
  const reactName = reactHookMatch[2];
  const jsxFactory = matchOne(source, /import\{n as \w+,t as (\w+)\}from"\.\/jsx-runtime-[^"]+\.js"/, "jsx factory alias")[1];
  const jsxName = matchOne(source, new RegExp(`var\\s+(\\w+)=${jsxFactory}\\(\\)`), "jsx alias")[1];
  const intlName = matchOne(source, /import\{[^}]*W as (\w+)[^}]*\}from"\.\/setting-storage-[^"]+\.js"/, "settings intl alias")[1];
  const rowName = matchOne(source, /import\{n as (\w+)\}from"\.\/settings-row-[^"]+\.js"/, "settings row alias")[1];
  const dropdownMatch = matchOne(source, /import\{r as (\w+),t as (\w+)\}from"\.\/dropdown-[^"]+\.js"/, "dropdown aliases");
  const dropdownRoot = dropdownMatch[1];
  const dropdownMenu = dropdownMatch[2];
  const checkIcon = matchOne(source, /import\{t as (\w+)\}from"\.\/check-md-[^"]+\.js"/, "check icon alias")[1];
  const sharedMatch = matchOne(source, /import\{i as (\w+),t as (\w+)\}from"\.\/settings-shared-[^"]+\.js"/, "settings shared aliases");
  const sharedButton = sharedMatch[2];

  const helper = `function ChainCloudApiKeyId(e){return String(e?.id??e?.key??\`\`)}function ChainCloudApiKeyLabel(e){let t=e?.name||\`Key\`,n=String(e?.key||\`\`),r=n.length>12?n.slice(0,7)+\`...\`+n.slice(-4):n;return r?\`\${t} (\${r})\`:t}function ChainCloudApiKeyList(e){let t=Array.isArray(e)?e:Array.isArray(e?.items)?e.items:Array.isArray(e?.data)?e.data:Array.isArray(e?.records)?e.records:[];return t.filter(e=>e&&e.key&&(e.status==null||e.status===\`active\`))}function ChainCloudApiKeySettingsRow(){let e=window.__chaincloudCodexAuth,t=${intlName}(),n=${reactName}.useState([]),r=n[0],i=n[1],a=${reactName}.useState(()=>e?.getSession?.()??null),o=a[0],s=a[1],c=${reactName}.useState(!1),l=c[0],u=c[1],d=${reactName}.useState(null),p=d[0],m=d[1],h=${reactName}.useCallback(async()=>{if(!e?.isLoggedIn?.()){i([]),s(null);return}u(!0),m(null);try{let t=ChainCloudApiKeyList(await e.listKeys?.());i(t);let n=e.getSession?.()??null;if(!n?.selectedApiKey&&t[0])await e.switchDesktopApiKey?.(t[0]),n=e.getSession?.()??n;s(n)}catch(e){m(e?.message||String(e))}finally{u(!1)}},[e]);${reactName}.useEffect(()=>{h();let t=()=>{s(e?.getSession?.()??null),h()};return window.addEventListener(\`chaincloud-auth-changed\`,t),window.addEventListener(\`chaincloud-api-key-selected\`,t),()=>{window.removeEventListener(\`chaincloud-auth-changed\`,t),window.removeEventListener(\`chaincloud-api-key-selected\`,t)}},[h,e]);if(!e?.isLoggedIn?.())return null;let g=ChainCloudApiKeyId(o?.selectedApiKey),_=r.find(e=>ChainCloudApiKeyId(e)===g)||r[0]||null,v=_?ChainCloudApiKeyId(_):g,y=l||r.length===0,b=p?(0,${jsxName}.jsx)(\`div\`,{className:\`text-sm text-token-error-foreground\`,children:p}):null;return(0,${jsxName}.jsx)(${rowName},{label:\`API \\u5bc6\\u94a5\`,description:(0,${jsxName}.jsxs)(\`div\`,{className:\`flex flex-col gap-1\`,children:[(0,${jsxName}.jsx)(\`div\`,{children:\`\\u9009\\u62e9\\u5f53\\u524d\\u7528\\u4e8e\\u8bf7\\u6c42\\u7684\\u94fe\\u8def\\u4e91 API \\u5bc6\\u94a5\`}),b]}),control:(0,${jsxName}.jsx)(${dropdownMenu},{align:\`end\`,contentWidth:\`panelWide\`,disabled:y,triggerButton:(0,${jsxName}.jsx)(${sharedButton},{disabled:y,contentClassName:\`truncate\`,children:l?\`\\u52a0\\u8f7d Key...\`:_?ChainCloudApiKeyLabel(_):\`\\u65e0\\u53ef\\u7528 Key\`}),children:r.map(e=>{let n=ChainCloudApiKeyId(e);return(0,${jsxName}.jsx)(${dropdownRoot}.Item,{RightIcon:n===v?${checkIcon}:void 0,onSelect:()=>{u(!0),m(null),Promise.resolve(window.__chaincloudCodexAuth?.switchDesktopApiKey?.(e)).then(()=>{s(window.__chaincloudCodexAuth?.getSession?.()??null),h()}).catch(e=>m(e?.message||String(e))).finally(()=>u(!1))},children:(0,${jsxName}.jsx)(\`span\`,{className:\`text-sm\`,children:ChainCloudApiKeyLabel(e)})},n)})})})}`;
  const functionNeedleMatch = source.match(/function\s+\w+\(\{hostId:e\}\)\{[\s\S]{0,9000}?settings\.agent\.configuration\.approval\.label/);
  if (!functionNeedleMatch) throw new Error("Unable to locate AgentSettings configuration component");
  const functionNeedle = functionNeedleMatch[0].match(/function\s+\w+\(\{hostId:e\}\)/)[0];
  source = source.replace(functionNeedle, helper + functionNeedle);

  const rowNeedle = `(0,${jsxName}.jsx)(${rowName},{label:(0,${jsxName}.jsx)(l,{id:\`settings.agent.configuration.approval.label\``;
  if (!source.includes(rowNeedle)) throw new Error("Unable to locate approval policy settings row");
  source = source.replace(rowNeedle, `(0,${jsxName}.jsx)(ChainCloudApiKeySettingsRow,{}),` + rowNeedle);

  if (!isCheck) write(file, source);
  return { file, changed: true };
}

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
    const login = patchLoginRoute(plat, isCheck);
    const profileTouched = patchProfileBundles(plat, isCheck);
    const composerTouched = patchComposerBundles(plat, isCheck);
    const localThreadTouched = patchLocalThreadBundles(plat, isCheck);
    const agentSettings = patchAgentSettingsBundle(plat, isCheck);

    for (const [label, changed, file] of [
      ["client", clientChanged, path.join(appRootFor(plat), "webview", "assets", CLIENT_FILE)],
      ["html", htmlChanged, path.join(appRootFor(plat), "webview", "index.html")],
      ["preload", preloadChanged, path.join(appRootFor(plat), ".vite", "build", "preload.js")],
      ["main-proxy", mainProxy.changed, mainProxy.file],
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
    for (const file of localThreadTouched) {
      changedCount++;
      console.log(`   * local-thread: ${relPath(file)}`);
    }
    if (localThreadTouched.length === 0) console.log("   [ok] local-thread: already patched or not present");
  }

  console.log(isCheck ? `\n[check] ${changedCount} pending change(s)` : `\n[ok] ChainCloud auth patch complete (${changedCount} change(s))`);
}

main();
