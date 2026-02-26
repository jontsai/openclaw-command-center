/**
 * Telegram Notifier
 *
 * Sends Telegram messages on critical-severity feed events.
 *
 * Config sources:
 *   Bot token:  ~/.openclaw/openclaw.json → channels.telegram.botToken
 *   Chat IDs:   ~/.openclaw/credentials/telegram-pairing.json → (array of { chatId })
 *
 * Debounce: max 1 notification per event type per 5 minutes.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const { getOpenClawDir } = require("./config");

const DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes

// Track last notification timestamp per event type
const lastSent = new Map();

/**
 * Read Telegram bot token from openclaw.json
 */
function getBotToken() {
  try {
    const configPath = path.join(getOpenClawDir(), "openclaw.json");
    if (!fs.existsSync(configPath)) return null;
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return config.channels?.telegram?.botToken || null;
  } catch (_e) {
    return null;
  }
}

/**
 * Read approved chat IDs from telegram-pairing.json
 */
function getChatIds() {
  try {
    const pairingPath = path.join(getOpenClawDir(), "credentials", "telegram-pairing.json");
    if (!fs.existsSync(pairingPath)) return [];
    const data = JSON.parse(fs.readFileSync(pairingPath, "utf8"));
    if (Array.isArray(data)) {
      return data.map((entry) => entry.chatId).filter(Boolean);
    }
    // Single object format
    if (data.chatId) return [data.chatId];
    return [];
  } catch (_e) {
    return [];
  }
}

/**
 * Check if this event type is debounced.
 */
function isDebounced(eventType) {
  const last = lastSent.get(eventType);
  if (!last) return false;
  return Date.now() - last < DEBOUNCE_MS;
}

/**
 * Format a feed entry into a concise Telegram message.
 */
function formatMessage(entry) {
  const icon = entry.severity === "critical" ? "\uD83D\uDD34" : "\u26A0\uFE0F";
  const type = entry.type || "event";
  return `${icon} [${type}] ${entry.message}`;
}

/**
 * Send a Telegram message using the Bot API (node built-in https).
 * Returns a Promise.
 */
function sendTelegram(botToken, chatId, text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" });

    const options = {
      hostname: "api.telegram.org",
      path: `/bot${botToken}/sendMessage`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`Telegram API ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Evaluate a feed entry and send Telegram notification if warranted.
 * Only fires for critical severity events: cost_spike, cron_fail, agent_error.
 */
async function notify(entry) {
  if (!entry || entry.severity !== "critical") return;

  const criticalTypes = new Set(["cost_spike", "cron_fail", "agent_error", "zombie_risk"]);
  if (!criticalTypes.has(entry.type)) return;

  if (isDebounced(entry.type)) {
    return;
  }

  const botToken = getBotToken();
  if (!botToken) return;

  const chatIds = getChatIds();
  if (chatIds.length === 0) return;

  const text = formatMessage(entry);

  // Mark debounce before sending (optimistic)
  lastSent.set(entry.type, Date.now());

  const results = [];
  for (const chatId of chatIds) {
    try {
      await sendTelegram(botToken, chatId, text);
      results.push({ chatId, ok: true });
    } catch (e) {
      console.error(`[Notifier] Failed to send to ${chatId}:`, e.message);
      results.push({ chatId, ok: false, error: e.message });
    }
  }

  return results;
}

/**
 * Reset debounce state (for testing).
 */
function _resetDebounce() {
  lastSent.clear();
}

/**
 * Get the internal lastSent map (for testing).
 */
function _getLastSent() {
  return lastSent;
}

module.exports = { notify, formatMessage, _resetDebounce, _getLastSent, sendTelegram, DEBOUNCE_MS };
