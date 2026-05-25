const CHAINCLOUD_ORIGIN = "https://dash.classicriver.cn";
const CHAINCLOUD_API_BASE = `${CHAINCLOUD_ORIGIN}/api/v1`;
const CHAINCLOUD_OPENAI_BASE_URL = `${CHAINCLOUD_ORIGIN}/v1`;
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
const QR_IMAGE_ORIGIN = "https://api.qrserver.com";
const CHAINCLOUD_IPC_CHANNEL = "codex_desktop:chaincloud-auth-request";
const CHAINCLOUD_LOGIN_IPC_CHANNEL = "codex_desktop:chaincloud-site-login";
const CHAINCLOUD_LOGOUT_IPC_CHANNEL = "codex_desktop:chaincloud-site-logout";
const CHAINCLOUD_CONFIG_IPC_CHANNEL = "codex_desktop:chaincloud-write-config";
const CLIENT_FILE = "chaincloud-auth.js";
const PATCH_MARKER = "__CHAINCLOUD_CODEX_AUTH_PATCH__";

module.exports = {
  CHAINCLOUD_API_BASE,
  CHAINCLOUD_CONFIG_IPC_CHANNEL,
  CHAINCLOUD_IPC_CHANNEL,
  CHAINCLOUD_LOGIN_IPC_CHANNEL,
  CHAINCLOUD_LOGOUT_IPC_CHANNEL,
  CHAINCLOUD_OPENAI_BASE_URL,
  CHAINCLOUD_ORIGIN,
  CLIENT_FILE,
  PATCH_MARKER,
  QR_IMAGE_ORIGIN,
  TURNSTILE_ORIGIN,
};
