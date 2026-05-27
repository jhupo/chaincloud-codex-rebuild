const {
  CHAINCLOUD_API_BASE,
  CHAINCLOUD_OPENAI_BASE_URL,
  CHAINCLOUD_ORIGIN,
  CHAINCLOUD_PROVIDER_ID,
  PATCH_MARKER,
} = require("./constants");

function jsClientSource() {
  return `// ${PATCH_MARKER}
(function(){
  const API_BASE = ${JSON.stringify(CHAINCLOUD_API_BASE)};
  const OPENAI_BASE_URL = ${JSON.stringify(CHAINCLOUD_OPENAI_BASE_URL)};
  const PROVIDER_ID = ${JSON.stringify(CHAINCLOUD_PROVIDER_ID)};
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
  function codexConfigEdits(){
    return [
      { keyPath: "model_provider", value: PROVIDER_ID, mergeStrategy: "upsert" },
      { keyPath: "model_providers." + PROVIDER_ID + ".name", value: "\\u94fe\\u8def\\u4e91", mergeStrategy: "upsert" },
      { keyPath: "model_providers." + PROVIDER_ID + ".base_url", value: OPENAI_BASE_URL, mergeStrategy: "upsert" },
      { keyPath: "model_providers." + PROVIDER_ID + ".wire_api", value: "responses", mergeStrategy: "upsert" }
    ];
  }
  function codexConfigPayload(){
    return {
      edits: codexConfigEdits(),
      filePath: null,
      expectedVersion: null,
      reloadUserConfig: true
    };
  }
  async function applyCodexConfig(writeConfig){
    if (typeof writeConfig !== "function") {
      await window.electronBridge?.chaincloudWriteConfig?.();
      return false;
    }
    await writeConfig(codexConfigPayload());
    window.dispatchEvent(new CustomEvent("chaincloud-codex-config-applied"));
    return true;
  }
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
    const session = getSession();
    const selectedKeyValue = session?.selectedApiKey?.key;
    let key = selectedKeyValue ? keys.find((k) => k && k.key === selectedKeyValue && (k.status == null || k.status === "active")) : null;
    key ||= keys.find((k) => k && k.status === "active" && k.key)
      || keys.find((k) => k && (k.status == null || k.status === "active") && k.key)
      || null;
    if (!key) key = await createDesktopKey();
    if (!key?.key) throw new Error("\u672a\u80fd\u83b7\u53d6\u53ef\u7528\u4e8e Codex \u7684 API Key");
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
    setSelectedApiKey(key);
    const switcher = await waitForApiKeySwitcher();
    if (switcher) await switcher(key.key);
    else console.warn("[ChainCloud] Codex API key switcher is not ready yet");
    return key;
  }
  function setSelectedApiKey(key){
    if (!key?.key) throw new Error("Invalid API key");
    const session = getSession();
    if (session) saveSession({ ...session, selectedApiKey: key });
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
    if (!summary) return "\u4eca -- \u00b7 \u4f59 --";
    return "\u4eca " + formatMoney(summary.todaySpent) + " \u00b7 \u4f59 " + formatMoney(summary.remaining);
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
      window.dispatchEvent(new CustomEvent("chaincloud-billing-updated", { detail: summary }));
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
    openaiBaseUrl: OPENAI_BASE_URL,
    providerId: PROVIDER_ID,
    storageKey: STORAGE_KEY,
    codexConfigEdits,
    codexConfigPayload,
    applyCodexConfig,
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
        setSelectedApiKey,
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
module.exports = { jsClientSource };
