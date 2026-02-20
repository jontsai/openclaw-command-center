#!/usr/bin/env node
/**
 * OpenClaw Command Center Dashboard Server
 * Serves the dashboard UI and provides API endpoints for status data
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync, exec } = require("child_process");
const { promisify } = require("util");

// Promisified exec for async operations
const execAsync = promisify(exec);

// Helper to run command and return stdout (with timeout and error handling)
async function runCmd(cmd, options = {}) {
  const opts = { encoding: "utf8", timeout: 10000, ...options };
  try {
    const { stdout } = await execAsync(cmd, opts);
    return stdout.trim();
  } catch (e) {
    if (options.fallback !== undefined) return options.fallback;
    throw e;
  }
}

// Note: jobs module loaded after env vars are set (see below)

// ============================================================================
// CLI ARGUMENT PARSING
// ============================================================================
const args = process.argv.slice(2);
let cliProfile = null;
let cliPort = null;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--profile":
    case "-p":
      cliProfile = args[++i];
      break;
    case "--port":
      cliPort = parseInt(args[++i], 10);
      break;
    case "--help":
    case "-h":
      console.log(`
OpenClaw Command Center

Usage: node lib/server.js [options]

Options:
  --profile, -p <name>  OpenClaw profile (uses ~/.openclaw-<name>)
  --port <port>         Server port (default: 3333)
  --help, -h            Show this help

Environment:
  OPENCLAW_PROFILE      Same as --profile
  PORT                  Same as --port

Examples:
  node lib/server.js --profile production
  node lib/server.js -p dev --port 3334
`);
      process.exit(0);
  }
}

// Set profile in environment so CONFIG and all CLI calls pick it up
if (cliProfile) {
  process.env.OPENCLAW_PROFILE = cliProfile;
}
if (cliPort) {
  process.env.PORT = cliPort.toString();
}

// Load config AFTER env vars are set (order matters for workspace detection)
const { CONFIG, getOpenClawDir } = require("./config");
// Load jobs module after config (it also requires config)
const { handleJobsRequest, isJobsRoute } = require("./jobs");

const PORT = CONFIG.server.port;
const DASHBOARD_DIR = path.join(__dirname, "../public");

// ============================================================================
// AUTH CONFIGURATION (from config.js)
// ============================================================================
const AUTH_CONFIG = {
  mode: CONFIG.auth.mode,
  token: CONFIG.auth.token,
  allowedUsers: CONFIG.auth.allowedUsers,
  allowedIPs: CONFIG.auth.allowedIPs,
  publicPaths: CONFIG.auth.publicPaths,
};

// Auth header names
const AUTH_HEADERS = {
  tailscale: {
    login: "tailscale-user-login",
    name: "tailscale-user-name",
    pic: "tailscale-user-profile-pic",
  },
  cloudflare: {
    email: "cf-access-authenticated-user-email",
  },
};

// ============================================================================
// PATHS CONFIGURATION (from config.js with auto-detection)
// ============================================================================
const PATHS = CONFIG.paths;

// SSE clients for real-time updates
const sseClients = new Set();

function sendSSE(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch (e) {
    // Client disconnected
  }
}

function broadcastSSE(event, data) {
  for (const client of sseClients) {
    sendSSE(client, event, data);
  }
}

// Profile-aware data directory (survives plugin updates)
// Uses ~/.openclaw/command-center/data or ~/.openclaw-<profile>/command-center/data
const DATA_DIR = path.join(getOpenClawDir(), "command-center", "data");
const LEGACY_DATA_DIR = path.join(DASHBOARD_DIR, "data");

/**
 * Migrate data from legacy location to profile-aware location
 * Runs once on startup, self-healing
 */
function migrateDataDir() {
  try {
    // Skip if legacy dir doesn't exist or new dir already has data
    if (!fs.existsSync(LEGACY_DATA_DIR)) return;

    // Ensure new data dir exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Check for files to migrate
    const legacyFiles = fs.readdirSync(LEGACY_DATA_DIR);
    if (legacyFiles.length === 0) return;

    let migrated = 0;
    for (const file of legacyFiles) {
      const srcPath = path.join(LEGACY_DATA_DIR, file);
      const destPath = path.join(DATA_DIR, file);

      // Skip if destination already exists (don't overwrite)
      if (fs.existsSync(destPath)) continue;

      // Copy file to new location
      const stat = fs.statSync(srcPath);
      if (stat.isFile()) {
        fs.copyFileSync(srcPath, destPath);
        migrated++;
        console.log(`[Migration] Copied ${file} to profile-aware data dir`);
      }
    }

    if (migrated > 0) {
      console.log(`[Migration] Migrated ${migrated} file(s) to ${DATA_DIR}`);
      console.log(`[Migration] Legacy data preserved at ${LEGACY_DATA_DIR}`);
    }
  } catch (e) {
    console.error("[Migration] Failed to migrate data:", e.message);
    // Non-fatal - continue with new location
  }
}

// Run migration on next tick (after module initialization)
process.nextTick(migrateDataDir);

// ============================================================================
// PRIVACY SETTINGS
// ============================================================================
const PRIVACY_FILE = path.join(DATA_DIR, "privacy-settings.json");

function loadPrivacySettings() {
  try {
    if (fs.existsSync(PRIVACY_FILE)) {
      return JSON.parse(fs.readFileSync(PRIVACY_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Failed to load privacy settings:", e.message);
  }
  return {
    version: 1,
    hiddenTopics: [],
    hiddenSessions: [],
    hiddenCrons: [],
    hideHostname: false,
    updatedAt: null,
  };
}

function savePrivacySettings(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(PRIVACY_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error("Failed to save privacy settings:", e.message);
    return false;
  }
}

// ============================================================================
// OPERATORS DATA
// ============================================================================
const OPERATORS_FILE = path.join(DATA_DIR, "operators.json");

function loadOperators() {
  try {
    if (fs.existsSync(OPERATORS_FILE)) {
      return JSON.parse(fs.readFileSync(OPERATORS_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Failed to load operators:", e.message);
  }
  return { version: 1, operators: [], roles: {} };
}

function saveOperators(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(OPERATORS_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error("Failed to save operators:", e.message);
    return false;
  }
}

function getOperatorBySlackId(slackId) {
  const data = loadOperators();
  return data.operators.find((op) => op.id === slackId || op.metadata?.slackId === slackId);
}

// Auto-detect operators from session transcripts (runs async in background)
let operatorsRefreshing = false;
async function refreshOperatorsAsync() {
  if (operatorsRefreshing) return;
  operatorsRefreshing = true;

  try {
    const openclawDir = getOpenClawDir();
    const sessionsDir = path.join(openclawDir, "agents", "main", "sessions");

    if (!fs.existsSync(sessionsDir)) {
      operatorsRefreshing = false;
      return;
    }

    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    const operatorsMap = new Map(); // userId -> operator data
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    for (const file of files) {
      const filePath = path.join(sessionsDir, file);
      try {
        const stat = fs.statSync(filePath);
        // Only scan files modified in last 7 days
        if (stat.mtimeMs < sevenDaysAgo) continue;

        // Read first 10KB of each file (enough to get user info)
        const fd = fs.openSync(filePath, "r");
        const buffer = Buffer.alloc(10240);
        const bytesRead = fs.readSync(fd, buffer, 0, 10240, 0);
        fs.closeSync(fd);

        const content = buffer.toString("utf8", 0, bytesRead);
        const lines = content.split("\n").slice(0, 20); // First 20 lines

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.type !== "message" || !entry.message) continue;

            const msg = entry.message;
            if (msg.role !== "user") continue;

            let text = "";
            if (typeof msg.content === "string") {
              text = msg.content;
            } else if (Array.isArray(msg.content)) {
              const textPart = msg.content.find((c) => c.type === "text");
              if (textPart) text = textPart.text || "";
            }

            if (!text) continue;

            // Extract Slack user: "[Slack #channel +Xm date] username (USERID):"
            const slackMatch = text.match(/\[Slack[^\]]*\]\s*([\w.-]+)\s*\(([A-Z0-9]+)\):/);
            if (slackMatch) {
              const username = slackMatch[1];
              const userId = slackMatch[2];

              if (!operatorsMap.has(userId)) {
                operatorsMap.set(userId, {
                  id: userId,
                  name: username,
                  username: username,
                  source: "slack",
                  firstSeen: entry.timestamp || stat.mtimeMs,
                  lastSeen: entry.timestamp || stat.mtimeMs,
                  sessionCount: 1,
                });
              } else {
                const op = operatorsMap.get(userId);
                op.lastSeen = Math.max(op.lastSeen, entry.timestamp || stat.mtimeMs);
                op.sessionCount++;
              }
              break; // Found user for this session, move to next file
            }

            // Also check for Telegram users: "[Telegram +Xm date] username:"
            const telegramMatch = text.match(/\[Telegram[^\]]*\]\s*([\w.-]+):/);
            if (telegramMatch) {
              const username = telegramMatch[1];
              const oderId = `telegram:${username}`;

              if (!operatorsMap.has(oderId)) {
                operatorsMap.set(oderId, {
                  id: oderId,
                  name: username,
                  username: username,
                  source: "telegram",
                  firstSeen: entry.timestamp || stat.mtimeMs,
                  lastSeen: entry.timestamp || stat.mtimeMs,
                  sessionCount: 1,
                });
              } else {
                const op = operatorsMap.get(oderId);
                op.lastSeen = Math.max(op.lastSeen, entry.timestamp || stat.mtimeMs);
                op.sessionCount++;
              }
              break;
            }

            // Check for Discord users in "Conversation info" JSON block
            // Pattern: "sender": "123456789012345678" and "label": "CoolUser123"
            const discordSenderMatch = text.match(/"sender":\s*"(\d+)"/);
            const discordLabelMatch = text.match(/"label":\s*"([^"]+)"/);
            const discordUsernameMatch = text.match(/"username":\s*"([^"]+)"/);

            if (discordSenderMatch) {
              const userId = discordSenderMatch[1];
              const label = discordLabelMatch ? discordLabelMatch[1] : userId;
              const username = discordUsernameMatch ? discordUsernameMatch[1] : label;
              const opId = `discord:${userId}`;

              if (!operatorsMap.has(opId)) {
                operatorsMap.set(opId, {
                  id: opId,
                  discordId: userId,
                  name: label,
                  username: username,
                  source: "discord",
                  firstSeen: entry.timestamp || stat.mtimeMs,
                  lastSeen: entry.timestamp || stat.mtimeMs,
                  sessionCount: 1,
                });
              } else {
                const op = operatorsMap.get(opId);
                op.lastSeen = Math.max(op.lastSeen, entry.timestamp || stat.mtimeMs);
                op.sessionCount++;
              }
              break;
            }
          } catch (e) {
            /* skip invalid lines */
          }
        }
      } catch (e) {
        /* skip unreadable files */
      }
    }

    // Load existing operators to preserve manual edits
    const existing = loadOperators();
    const existingMap = new Map(existing.operators.map((op) => [op.id, op]));

    // Merge: auto-detected + existing manual entries
    for (const [id, autoOp] of operatorsMap) {
      if (existingMap.has(id)) {
        // Update stats but preserve manual fields
        const manual = existingMap.get(id);
        manual.lastSeen = Math.max(manual.lastSeen || 0, autoOp.lastSeen);
        manual.sessionCount = (manual.sessionCount || 0) + autoOp.sessionCount;
      } else {
        existingMap.set(id, autoOp);
      }
    }

    // Save merged operators
    const merged = {
      version: 1,
      operators: Array.from(existingMap.values()).sort(
        (a, b) => (b.lastSeen || 0) - (a.lastSeen || 0),
      ),
      roles: existing.roles || {},
      lastRefreshed: Date.now(),
    };

    saveOperators(merged);
    console.log(`[Operators] Refreshed: ${merged.operators.length} operators detected`);
  } catch (e) {
    console.error("[Operators] Refresh failed:", e.message);
  }

  operatorsRefreshing = false;
}

// Start background operators refresh
setTimeout(() => refreshOperatorsAsync(), 2000);
setInterval(() => refreshOperatorsAsync(), 5 * 60 * 1000); // Every 5 minutes

// Extract session originator from transcript
function getSessionOriginator(sessionId) {
  try {
    if (!sessionId) return null;

    const openclawDir = getOpenClawDir();
    const transcriptPath = path.join(
      openclawDir,
      "agents",
      "main",
      "sessions",
      `${sessionId}.jsonl`,
    );

    if (!fs.existsSync(transcriptPath)) return null;

    const content = fs.readFileSync(transcriptPath, "utf8");
    const lines = content.trim().split("\n");

    // Find the first user message to extract originator
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.type !== "message" || !entry.message) continue;

        const msg = entry.message;
        if (msg.role !== "user") continue;

        let text = "";
        if (typeof msg.content === "string") {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          const textPart = msg.content.find((c) => c.type === "text");
          if (textPart) text = textPart.text || "";
        }

        if (!text) continue;

        // Extract Slack user from message patterns:
        // Example: "[Slack #channel +6m 2026-01-27 15:31 PST] username (USERID): message"
        // Pattern: "username (USERID):" where USERID is the sender's Slack ID
        const slackUserMatch = text.match(/\]\s*([\w.-]+)\s*\(([A-Z0-9]+)\):/);

        if (slackUserMatch) {
          const username = slackUserMatch[1];
          const userId = slackUserMatch[2];

          const operator = getOperatorBySlackId(userId);

          return {
            userId,
            username,
            displayName: operator?.name || username,
            role: operator?.role || "user",
            avatar: operator?.avatar || null,
          };
        }
      } catch (e) {}
    }

    return null;
  } catch (e) {
    return null;
  }
}

// Utility functions
function formatBytes(bytes) {
  if (bytes >= 1099511627776) return (bytes / 1099511627776).toFixed(1) + " TB";
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + " GB";
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
}

function formatTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.round(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.round(diffMins / 60)}h ago`;
  return `${Math.round(diffMins / 1440)}d ago`;
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

// Check if user is authorized
function checkAuth(req) {
  const mode = AUTH_CONFIG.mode;

  // Always allow localhost access (for direct physical machine access)
  const remoteAddr = req.socket?.remoteAddress || "";
  const isLocalhost =
    remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1";
  if (isLocalhost) {
    return { authorized: true, user: { type: "localhost", login: "localhost" } };
  }

  // No auth mode - allow all
  if (mode === "none") {
    return { authorized: true, user: null };
  }

  // Token mode - check Bearer token
  if (mode === "token") {
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (token && token === AUTH_CONFIG.token) {
      return { authorized: true, user: { type: "token" } };
    }
    return { authorized: false, reason: "Invalid or missing token" };
  }

  // Tailscale mode - check Tailscale-User-Login header
  if (mode === "tailscale") {
    const login = (req.headers[AUTH_HEADERS.tailscale.login] || "").toLowerCase();
    const name = req.headers[AUTH_HEADERS.tailscale.name] || "";
    const pic = req.headers[AUTH_HEADERS.tailscale.pic] || "";

    if (!login) {
      return { authorized: false, reason: "Not accessed via Tailscale Serve" };
    }

    // Check if user is in allowlist
    const isAllowed = AUTH_CONFIG.allowedUsers.some((allowed) => {
      if (allowed === "*") return true;
      if (allowed === login) return true;
      // Support wildcards like *@github
      if (allowed.startsWith("*@")) {
        const domain = allowed.slice(2);
        return login.endsWith("@" + domain);
      }
      return false;
    });

    if (isAllowed) {
      return { authorized: true, user: { type: "tailscale", login, name, pic } };
    }
    return { authorized: false, reason: `User ${login} not in allowlist`, user: { login } };
  }

  // Cloudflare mode - check Cf-Access-Authenticated-User-Email header
  if (mode === "cloudflare") {
    const email = (req.headers[AUTH_HEADERS.cloudflare.email] || "").toLowerCase();

    if (!email) {
      return { authorized: false, reason: "Not accessed via Cloudflare Access" };
    }

    const isAllowed = AUTH_CONFIG.allowedUsers.some((allowed) => {
      if (allowed === "*") return true;
      if (allowed === email) return true;
      if (allowed.startsWith("*@")) {
        const domain = allowed.slice(2);
        return email.endsWith("@" + domain);
      }
      return false;
    });

    if (isAllowed) {
      return { authorized: true, user: { type: "cloudflare", email } };
    }
    return { authorized: false, reason: `User ${email} not in allowlist`, user: { email } };
  }

  // IP allowlist mode
  if (mode === "allowlist") {
    const clientIP =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "";

    const isAllowed = AUTH_CONFIG.allowedIPs.some((allowed) => {
      if (allowed === clientIP) return true;
      // Simple CIDR check for /24
      if (allowed.endsWith("/24")) {
        const prefix = allowed.slice(0, -3).split(".").slice(0, 3).join(".");
        return clientIP.startsWith(prefix + ".");
      }
      return false;
    });

    if (isAllowed) {
      return { authorized: true, user: { type: "ip", ip: clientIP } };
    }
    return { authorized: false, reason: `IP ${clientIP} not in allowlist` };
  }

  return { authorized: false, reason: "Unknown auth mode" };
}

// Generate login/unauthorized page
function getUnauthorizedPage(reason, user) {
  const userInfo = user
    ? `<p class="user-info">Detected: ${user.login || user.email || user.ip || "unknown"}</p>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
    <title>Access Denied - Command Center</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #e8e8e8;
        }
        .container {
            text-align: center;
            padding: 3rem;
            background: rgba(255,255,255,0.05);
            border-radius: 16px;
            border: 1px solid rgba(255,255,255,0.1);
            max-width: 500px;
        }
        .icon { font-size: 4rem; margin-bottom: 1rem; }
        h1 { font-size: 1.8rem; margin-bottom: 1rem; color: #ff6b6b; }
        .reason { color: #aaa; margin-bottom: 1.5rem; font-size: 0.95rem; }
        .user-info { color: #ffeb3b; margin: 1rem 0; font-size: 0.9rem; }
        .instructions { color: #ccc; font-size: 0.85rem; line-height: 1.5; }
        .auth-mode { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1); color: #888; font-size: 0.75rem; }
        code { background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">🔐</div>
        <h1>Access Denied</h1>
        <div class="reason">${reason}</div>
        ${userInfo}
        <div class="instructions">
            <p>This dashboard requires authentication via <strong>${AUTH_CONFIG.mode}</strong>.</p>
            ${AUTH_CONFIG.mode === "tailscale" ? '<p style="margin-top:1rem">Make sure you\'re accessing via your Tailscale URL and your account is in the allowlist.</p>' : ""}
            ${AUTH_CONFIG.mode === "cloudflare" ? '<p style="margin-top:1rem">Make sure you\'re accessing via Cloudflare Access and your email is in the allowlist.</p>' : ""}
        </div>
        <div class="auth-mode">Auth mode: <code>${AUTH_CONFIG.mode}</code></div>
    </div>
</body>
</html>`;
}

// Vitals cache to reduce blocking
let cachedVitals = null;
let lastVitalsUpdate = 0;
const VITALS_CACHE_TTL = 30000; // 30 seconds - vitals don't change fast
let vitalsRefreshing = false;

// Async background refresh of system vitals (non-blocking)
async function refreshVitalsAsync() {
  if (vitalsRefreshing) return;
  vitalsRefreshing = true;

  const vitals = {
    hostname: "",
    uptime: "",
    disk: { used: 0, free: 0, total: 0, percent: 0, kbPerTransfer: 0, iops: 0, throughputMBps: 0 },
    cpu: { loadAvg: [0, 0, 0], cores: 0, usage: 0 },
    memory: { used: 0, free: 0, total: 0, percent: 0, pressure: "normal" },
    temperature: null,
  };

  // Detect platform for cross-platform support
  const isLinux = process.platform === "linux";
  const isMacOS = process.platform === "darwin";

  try {
    // Platform-specific commands
    const coresCmd = isLinux ? "nproc" : "sysctl -n hw.ncpu";
    const memCmd = isLinux
      ? "cat /proc/meminfo | grep MemTotal | awk '{print $2}'"
      : "sysctl -n hw.memsize";
    const topCmd = isLinux
      ? "top -bn1 | head -3 | grep -E '^%?Cpu|^  ?CPU' || echo ''"
      : 'top -l 1 -n 0 2>/dev/null | grep "CPU usage" || echo ""';

    // Run commands in parallel for speed
    const [hostname, uptimeRaw, coresRaw, memTotalRaw, memInfoRaw, dfRaw, topOutput] =
      await Promise.all([
        runCmd("hostname", { fallback: "unknown" }),
        runCmd("uptime", { fallback: "" }),
        runCmd(coresCmd, { fallback: "1" }),
        runCmd(memCmd, { fallback: "0" }),
        isLinux
          ? runCmd("cat /proc/meminfo", { fallback: "" })
          : runCmd("vm_stat", { fallback: "" }),
        runCmd("df -k ~ | tail -1", { fallback: "" }),
        runCmd(topCmd, { fallback: "" }),
      ]);

    vitals.hostname = hostname;

    // Parse uptime
    const uptimeMatch = uptimeRaw.match(/up\s+([^,]+)/);
    if (uptimeMatch) vitals.uptime = uptimeMatch[1].trim();
    const loadMatch = uptimeRaw.match(/load averages?:\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
    if (loadMatch)
      vitals.cpu.loadAvg = [
        parseFloat(loadMatch[1]),
        parseFloat(loadMatch[2]),
        parseFloat(loadMatch[3]),
      ];

    // CPU
    vitals.cpu.cores = parseInt(coresRaw, 10) || 1;
    vitals.cpu.usage = Math.min(100, Math.round((vitals.cpu.loadAvg[0] / vitals.cpu.cores) * 100));

    // Parse CPU usage from top (platform-specific)
    if (topOutput) {
      if (isLinux) {
        // Linux: %Cpu(s):  5.9 us,  2.0 sy,  0.0 ni, 91.5 id,  0.5 wa, ...
        const userMatch = topOutput.match(/([\d.]+)\s*us/);
        const sysMatch = topOutput.match(/([\d.]+)\s*sy/);
        const idleMatch = topOutput.match(/([\d.]+)\s*id/);
        vitals.cpu.userPercent = userMatch ? parseFloat(userMatch[1]) : null;
        vitals.cpu.sysPercent = sysMatch ? parseFloat(sysMatch[1]) : null;
        vitals.cpu.idlePercent = idleMatch ? parseFloat(idleMatch[1]) : null;
        if (vitals.cpu.userPercent !== null && vitals.cpu.sysPercent !== null) {
          vitals.cpu.usage = Math.round(vitals.cpu.userPercent + vitals.cpu.sysPercent);
        }
      } else {
        // macOS: CPU usage: 5.9% user, 2.0% sys, 91.5% idle
        const userMatch = topOutput.match(/([\d.]+)%\s*user/);
        const sysMatch = topOutput.match(/([\d.]+)%\s*sys/);
        const idleMatch = topOutput.match(/([\d.]+)%\s*idle/);
        vitals.cpu.userPercent = userMatch ? parseFloat(userMatch[1]) : null;
        vitals.cpu.sysPercent = sysMatch ? parseFloat(sysMatch[1]) : null;
        vitals.cpu.idlePercent = idleMatch ? parseFloat(idleMatch[1]) : null;
        if (vitals.cpu.userPercent !== null && vitals.cpu.sysPercent !== null) {
          vitals.cpu.usage = Math.round(vitals.cpu.userPercent + vitals.cpu.sysPercent);
        }
      }
    }

    // Disk
    const dfParts = dfRaw.split(/\s+/);
    if (dfParts.length >= 4) {
      vitals.disk.total = parseInt(dfParts[1], 10) * 1024;
      vitals.disk.used = parseInt(dfParts[2], 10) * 1024;
      vitals.disk.free = parseInt(dfParts[3], 10) * 1024;
      vitals.disk.percent = Math.round((parseInt(dfParts[2], 10) / parseInt(dfParts[1], 10)) * 100);
    }

    // Memory (platform-specific)
    if (isLinux) {
      // Linux: parse /proc/meminfo
      const memTotalKB = parseInt(memTotalRaw, 10) || 0;
      const memAvailableMatch = memInfoRaw.match(/MemAvailable:\s+(\d+)/);
      const memFreeMatch = memInfoRaw.match(/MemFree:\s+(\d+)/);

      vitals.memory.total = memTotalKB * 1024;
      const memAvailable = parseInt(memAvailableMatch?.[1] || memFreeMatch?.[1] || 0, 10) * 1024;

      // On Linux, "used" = total - available (more accurate than total - free)
      vitals.memory.used = vitals.memory.total - memAvailable;
      vitals.memory.free = memAvailable;
      vitals.memory.percent =
        vitals.memory.total > 0 ? Math.round((vitals.memory.used / vitals.memory.total) * 100) : 0;
    } else {
      // macOS: parse vm_stat
      const pageSize = 16384;
      const activePages = parseInt((memInfoRaw.match(/Pages active:\s+(\d+)/) || [])[1] || 0, 10);
      const wiredPages = parseInt(
        (memInfoRaw.match(/Pages wired down:\s+(\d+)/) || [])[1] || 0,
        10,
      );
      const compressedPages = parseInt(
        (memInfoRaw.match(/Pages occupied by compressor:\s+(\d+)/) || [])[1] || 0,
        10,
      );
      vitals.memory.total = parseInt(memTotalRaw, 10) || 0;
      vitals.memory.used = (activePages + wiredPages + compressedPages) * pageSize;
      vitals.memory.free = vitals.memory.total - vitals.memory.used;
      vitals.memory.percent =
        vitals.memory.total > 0 ? Math.round((vitals.memory.used / vitals.memory.total) * 100) : 0;
    }
    vitals.memory.pressure =
      vitals.memory.percent > 90 ? "critical" : vitals.memory.percent > 75 ? "warning" : "normal";

    // Secondary async calls (chip info, iostat) - macOS only for chip info
    const iostatCmd = isLinux
      ? "iostat -d 2 2>/dev/null | tail -1 || echo ''"
      : "iostat -d -c 2 2>/dev/null | tail -1 || echo ''";
    const [perfCores, effCores, chip, iostatRaw] = await Promise.all([
      isMacOS
        ? runCmd("sysctl -n hw.perflevel0.logicalcpu 2>/dev/null || echo 0", { fallback: "0" })
        : Promise.resolve("0"),
      isMacOS
        ? runCmd("sysctl -n hw.perflevel1.logicalcpu 2>/dev/null || echo 0", { fallback: "0" })
        : Promise.resolve("0"),
      isMacOS
        ? runCmd(
            'system_profiler SPHardwareDataType 2>/dev/null | grep "Chip:" | cut -d: -f2 || echo ""',
            { fallback: "" },
          )
        : Promise.resolve(""),
      runCmd(iostatCmd, { fallback: "" }),
    ]);

    // Get CPU brand on Linux
    if (isLinux) {
      const cpuBrand = await runCmd(
        "cat /proc/cpuinfo | grep 'model name' | head -1 | cut -d: -f2",
        { fallback: "" },
      );
      if (cpuBrand) vitals.cpu.brand = cpuBrand.trim();
    }

    vitals.cpu.pCores = parseInt(perfCores, 10) || null;
    vitals.cpu.eCores = parseInt(effCores, 10) || null;
    if (chip) vitals.cpu.chip = chip;
    const iostatParts = iostatRaw.split(/\s+/);
    if (iostatParts.length >= 3) {
      vitals.disk.kbPerTransfer = parseFloat(iostatParts[0]) || 0;
      vitals.disk.iops = parseFloat(iostatParts[1]) || 0;
      vitals.disk.throughputMBps = parseFloat(iostatParts[2]) || 0;
    }
    vitals.temperatureNote = vitals.cpu.chip ? "Apple Silicon (requires elevated access)" : null;
  } catch (e) {
    console.error("[Vitals] Async refresh failed:", e.message);
  }

  // Formatted versions
  vitals.memory.usedFormatted = formatBytes(vitals.memory.used);
  vitals.memory.totalFormatted = formatBytes(vitals.memory.total);
  vitals.memory.freeFormatted = formatBytes(vitals.memory.free);
  vitals.disk.usedFormatted = formatBytes(vitals.disk.used);
  vitals.disk.totalFormatted = formatBytes(vitals.disk.total);
  vitals.disk.freeFormatted = formatBytes(vitals.disk.free);

  cachedVitals = vitals;
  lastVitalsUpdate = Date.now();
  vitalsRefreshing = false;
  console.log("[Vitals] Cache refreshed async");
}

// Start background vitals refresh on startup
setTimeout(() => refreshVitalsAsync(), 500);
setInterval(() => refreshVitalsAsync(), VITALS_CACHE_TTL);

// Get detailed system vitals (iStatMenus-style) - returns cached, triggers async refresh
function getSystemVitals() {
  const now = Date.now();
  // Trigger async refresh if stale or no cache
  if (!cachedVitals || now - lastVitalsUpdate > VITALS_CACHE_TTL) {
    refreshVitalsAsync(); // Non-blocking
  }
  // Return cached data if available
  if (cachedVitals) return cachedVitals;

  // Return placeholder on first call (async refresh will populate cache within ~1s)
  return {
    hostname: "loading...",
    uptime: "",
    disk: {
      used: 0,
      free: 0,
      total: 0,
      percent: 0,
      usedFormatted: "-",
      totalFormatted: "-",
      freeFormatted: "-",
    },
    cpu: { loadAvg: [0, 0, 0], cores: 0, usage: 0 },
    memory: {
      used: 0,
      free: 0,
      total: 0,
      percent: 0,
      pressure: "normal",
      usedFormatted: "-",
      totalFormatted: "-",
      freeFormatted: "-",
    },
    temperature: null,
  };
}

// ========== OLD SYNC CODE DISABLED ==========
// The following was the original blocking implementation.
// It has been replaced by refreshVitalsAsync() above which runs in background.
// Keeping for reference but this function is never called.
function getSystemVitalsOLD_DISABLED() {
  const vitals = {
    hostname: "",
    uptime: "",
    disk: { used: 0, free: 0, total: 0, percent: 0 },
    cpu: { loadAvg: [0, 0, 0], cores: 0, usage: 0 },
    memory: { used: 0, free: 0, total: 0, percent: 0, pressure: "normal" },
    temperature: null,
  };

  try {
    // DISABLED - these execSync calls were blocking the event loop
    vitals.hostname = "disabled"; // was: execSync("hostname", { encoding: "utf8" }).trim();

    // Uptime
    const uptimeRaw = execSync("uptime", { encoding: "utf8" });
    const uptimeMatch = uptimeRaw.match(/up\s+([^,]+)/);
    if (uptimeMatch) vitals.uptime = uptimeMatch[1].trim();

    // Load averages from uptime
    const loadMatch = uptimeRaw.match(/load averages?:\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
    if (loadMatch) {
      vitals.cpu.loadAvg = [
        parseFloat(loadMatch[1]),
        parseFloat(loadMatch[2]),
        parseFloat(loadMatch[3]),
      ];
    }

    // CPU cores and topology
    try {
      const coresRaw = execSync("sysctl -n hw.ncpu", { encoding: "utf8" });
      vitals.cpu.cores = parseInt(coresRaw.trim(), 10);
      // Calculate usage as percentage of max load (cores * 1.0)
      vitals.cpu.usage = Math.min(
        100,
        Math.round((vitals.cpu.loadAvg[0] / vitals.cpu.cores) * 100),
      );

      // Get P-core and E-core counts (Apple Silicon)
      try {
        const perfCores = execSync("sysctl -n hw.perflevel0.logicalcpu 2>/dev/null || echo 0", {
          encoding: "utf8",
        });
        const effCores = execSync("sysctl -n hw.perflevel1.logicalcpu 2>/dev/null || echo 0", {
          encoding: "utf8",
        });
        vitals.cpu.pCores = parseInt(perfCores.trim(), 10) || null;
        vitals.cpu.eCores = parseInt(effCores.trim(), 10) || null;
      } catch (e) {}

      // Get CPU brand
      try {
        const brand = execSync('sysctl -n machdep.cpu.brand_string 2>/dev/null || echo ""', {
          encoding: "utf8",
        }).trim();
        if (brand) vitals.cpu.brand = brand;
      } catch (e) {}

      // Get chip name for Apple Silicon
      try {
        const chip = execSync(
          'system_profiler SPHardwareDataType 2>/dev/null | grep "Chip:" | cut -d: -f2',
          { encoding: "utf8" },
        ).trim();
        if (chip) vitals.cpu.chip = chip;
      } catch (e) {}
    } catch (e) {}

    // Get CPU usage breakdown (user/sys/idle) from top
    try {
      const topOutput = execSync('top -l 1 -n 0 2>/dev/null | grep "CPU usage"', {
        encoding: "utf8",
      });
      const userMatch = topOutput.match(/([\d.]+)%\s*user/);
      const sysMatch = topOutput.match(/([\d.]+)%\s*sys/);
      const idleMatch = topOutput.match(/([\d.]+)%\s*idle/);

      vitals.cpu.userPercent = userMatch ? parseFloat(userMatch[1]) : null;
      vitals.cpu.sysPercent = sysMatch ? parseFloat(sysMatch[1]) : null;
      vitals.cpu.idlePercent = idleMatch ? parseFloat(idleMatch[1]) : null;

      // Calculate actual usage from user + sys
      if (vitals.cpu.userPercent !== null && vitals.cpu.sysPercent !== null) {
        vitals.cpu.usage = Math.round(vitals.cpu.userPercent + vitals.cpu.sysPercent);
      }
    } catch (e) {}

    // Disk usage (macOS df - use ~ to get Data volume, not read-only system volume)
    try {
      const dfRaw = execSync("df -k ~ | tail -1", { encoding: "utf8" });
      const dfParts = dfRaw.trim().split(/\s+/);
      if (dfParts.length >= 4) {
        const totalKb = parseInt(dfParts[1], 10);
        const usedKb = parseInt(dfParts[2], 10);
        const freeKb = parseInt(dfParts[3], 10);
        vitals.disk.total = totalKb * 1024;
        vitals.disk.used = usedKb * 1024;
        vitals.disk.free = freeKb * 1024;
        vitals.disk.percent = Math.round((usedKb / totalKb) * 100);
      }
    } catch (e) {}

    // Disk I/O stats (macOS iostat) - IOPS, throughput, transfer size
    try {
      // Get 1-second sample from iostat (2 iterations, take the last one for current activity)
      const iostatRaw = execSync("iostat -d -c 2 2>/dev/null | tail -1", { encoding: "utf8" });
      const iostatParts = iostatRaw.trim().split(/\s+/);
      // iostat output: KB/t tps MB/s (repeated for each disk)
      // We take the first disk's stats (primary disk)
      if (iostatParts.length >= 3) {
        vitals.disk.kbPerTransfer = parseFloat(iostatParts[0]) || 0;
        vitals.disk.iops = parseFloat(iostatParts[1]) || 0;
        vitals.disk.throughputMBps = parseFloat(iostatParts[2]) || 0;
      }
    } catch (e) {
      // iostat may not be available or may fail
      vitals.disk.kbPerTransfer = 0;
      vitals.disk.iops = 0;
      vitals.disk.throughputMBps = 0;
    }

    // Memory (macOS vm_stat + sysctl)
    try {
      const memTotalRaw = execSync("sysctl -n hw.memsize", { encoding: "utf8" });
      vitals.memory.total = parseInt(memTotalRaw.trim(), 10);

      const vmStatRaw = execSync("vm_stat", { encoding: "utf8" });
      const pageSize = 16384; // Default macOS page size

      // Parse vm_stat
      const freeMatch = vmStatRaw.match(/Pages free:\s+(\d+)/);
      const activeMatch = vmStatRaw.match(/Pages active:\s+(\d+)/);
      const inactiveMatch = vmStatRaw.match(/Pages inactive:\s+(\d+)/);
      const wiredMatch = vmStatRaw.match(/Pages wired down:\s+(\d+)/);
      const compressedMatch = vmStatRaw.match(/Pages occupied by compressor:\s+(\d+)/);

      const freePages = freeMatch ? parseInt(freeMatch[1], 10) : 0;
      const activePages = activeMatch ? parseInt(activeMatch[1], 10) : 0;
      const inactivePages = inactiveMatch ? parseInt(inactiveMatch[1], 10) : 0;
      const wiredPages = wiredMatch ? parseInt(wiredMatch[1], 10) : 0;
      const compressedPages = compressedMatch ? parseInt(compressedMatch[1], 10) : 0;

      // Used = active + wired + compressed
      const usedPages = activePages + wiredPages + compressedPages;
      vitals.memory.used = usedPages * pageSize;
      vitals.memory.free = vitals.memory.total - vitals.memory.used;
      vitals.memory.percent = Math.round((vitals.memory.used / vitals.memory.total) * 100);

      // Expose detailed breakdown
      vitals.memory.active = activePages * pageSize;
      vitals.memory.wired = wiredPages * pageSize;
      vitals.memory.compressed = compressedPages * pageSize;
      vitals.memory.cached = inactivePages * pageSize;
      vitals.memory.pageSize = pageSize;

      // Memory pressure (simplified)
      const pressureRatio = vitals.memory.used / vitals.memory.total;
      if (pressureRatio > 0.9) vitals.memory.pressure = "critical";
      else if (pressureRatio > 0.75) vitals.memory.pressure = "warning";
      else vitals.memory.pressure = "normal";
    } catch (e) {}

    // Temperature (macOS - detect Apple Silicon vs Intel)
    vitals.temperature = null;
    vitals.temperatureNote = null;

    // Check if Apple Silicon
    const isAppleSilicon = vitals.cpu.chip || vitals.cpu.pCores;

    if (isAppleSilicon) {
      // Apple Silicon: temperature requires sudo powermetrics
      vitals.temperatureNote = "Apple Silicon (requires elevated access)";

      // Try to read from powermetrics if available (won't work without sudo)
      try {
        const pmOutput = execSync(
          'timeout 2 sudo -n powermetrics --samplers smc -i 1 -n 1 2>/dev/null | grep -i "die temp" | head -1 || echo ""',
          { encoding: "utf8" },
        ).trim();
        const tempMatch = pmOutput.match(/([\d.]+)/);
        if (tempMatch) {
          vitals.temperature = parseFloat(tempMatch[1]);
          vitals.temperatureNote = null;
        }
      } catch (e) {}
    } else {
      // Intel Mac: try osx-cpu-temp
      try {
        const temp = execSync('osx-cpu-temp 2>/dev/null || echo ""', { encoding: "utf8" }).trim();
        if (temp && temp.includes("°")) {
          const tempMatch = temp.match(/([\d.]+)/);
          if (tempMatch && parseFloat(tempMatch[1]) > 0) {
            vitals.temperature = parseFloat(tempMatch[1]);
          }
        }
      } catch (e) {}

      // Fallback: try ioreg for battery temp
      if (!vitals.temperature) {
        try {
          const ioregRaw = execSync(
            'ioreg -r -n AppleSmartBattery 2>/dev/null | grep Temperature || echo ""',
            { encoding: "utf8" },
          );
          const tempMatch = ioregRaw.match(/"Temperature"\s*=\s*(\d+)/);
          if (tempMatch) {
            vitals.temperature = Math.round(parseInt(tempMatch[1], 10) / 100);
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    console.error("Failed to get system vitals:", e.message);
  }

  // Add formatted versions for display
  vitals.memory.usedFormatted = formatBytes(vitals.memory.used);
  vitals.memory.totalFormatted = formatBytes(vitals.memory.total);
  vitals.memory.freeFormatted = formatBytes(vitals.memory.free);
  vitals.disk.usedFormatted = formatBytes(vitals.disk.used);
  vitals.disk.totalFormatted = formatBytes(vitals.disk.total);
  vitals.disk.freeFormatted = formatBytes(vitals.disk.free);

  // Cache the result
  cachedVitals = vitals;
  lastVitalsUpdate = Date.now();

  return vitals;
}

// Helper to run openclaw commands
function runOpenClaw(args) {
  const profile = process.env.OPENCLAW_PROFILE || "";
  const profileFlag = profile ? ` --profile ${profile}` : "";
  try {
    const result = execSync(`openclaw${profileFlag} ${args}`, {
      encoding: "utf8",
      timeout: 3000, // 3 second timeout - don't block server
      env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
      stdio: ["pipe", "pipe", "pipe"], // Capture all output
    });
    return result;
  } catch (e) {
    // Don't log every failure - these are expected when CLI is slow
    return null;
  }
}

// Async version of runOpenClaw - doesn't block event loop
async function runOpenClawAsync(args) {
  const profile = process.env.OPENCLAW_PROFILE || "";
  const profileFlag = profile ? ` --profile ${profile}` : "";
  try {
    const { stdout } = await execAsync(`openclaw${profileFlag} ${args}`, {
      encoding: "utf8",
      timeout: 10000, // 10 second timeout for async
      env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
    });
    return stdout;
  } catch (e) {
    console.error("[OpenClaw Async] Error:", e.message);
    return null;
  }
}

// ============================================================================
// SESSION CACHE - Async refresh to avoid blocking
// ============================================================================
let sessionsCache = { sessions: [], timestamp: 0, refreshing: false };
const SESSIONS_CACHE_TTL = 10000; // 10 seconds

async function refreshSessionsCache() {
  if (sessionsCache.refreshing) return; // Don't double-refresh
  sessionsCache.refreshing = true;

  try {
    const output = await runOpenClawAsync("sessions list --json 2>/dev/null");
    const jsonStr = extractJSON(output);
    if (jsonStr) {
      const data = JSON.parse(jsonStr);
      const sessions = data.sessions || [];

      // Map sessions (same logic as getSessions)
      const mapped = sessions.map((s) => mapSession(s));

      sessionsCache = {
        sessions: mapped,
        timestamp: Date.now(),
        refreshing: false,
      };
      console.log(`[Sessions Cache] Refreshed: ${mapped.length} sessions`);
    }
  } catch (e) {
    console.error("[Sessions Cache] Refresh error:", e.message);
  }
  sessionsCache.refreshing = false;
}

// Get sessions from cache, trigger async refresh if stale
function getSessionsCached() {
  const now = Date.now();
  const isStale = now - sessionsCache.timestamp > SESSIONS_CACHE_TTL;

  if (isStale && !sessionsCache.refreshing) {
    // Trigger async refresh (don't await - return stale data immediately)
    refreshSessionsCache();
  }

  return sessionsCache.sessions;
}

// Helper to map a single session (extracted from getSessions)
function mapSession(s) {
  const minutesAgo = s.ageMs ? s.ageMs / 60000 : Infinity;

  // Determine channel type from key (messaging platform)
  let channel = "other";
  if (s.key.includes("slack")) channel = "slack";
  else if (s.key.includes("telegram")) channel = "telegram";
  else if (s.key.includes("discord")) channel = "discord";
  else if (s.key.includes("signal")) channel = "signal";
  else if (s.key.includes("whatsapp")) channel = "whatsapp";

  // Determine session type (main, subagent, cron, channel-based)
  let sessionType = "channel";
  if (s.key.includes(":subagent:")) sessionType = "subagent";
  else if (s.key.includes(":cron:")) sessionType = "cron";
  else if (s.key === "agent:main:main") sessionType = "main";

  const originator = getSessionOriginator(s.sessionId);
  const label = s.groupChannel || s.displayName || parseSessionLabel(s.key);
  const topic = getSessionTopic(s.sessionId);

  const totalTokens = s.totalTokens || 0;
  const sessionAgeMinutes = Math.max(1, Math.min(minutesAgo, 24 * 60));
  const burnRate = Math.round(totalTokens / sessionAgeMinutes);

  return {
    sessionKey: s.key,
    sessionId: s.sessionId,
    label: label,
    groupChannel: s.groupChannel || null,
    displayName: s.displayName || null,
    kind: s.kind,
    channel: channel,
    sessionType: sessionType,
    active: minutesAgo < 15,
    recentlyActive: minutesAgo < 60,
    minutesAgo: Math.round(minutesAgo),
    tokens: s.totalTokens || 0,
    model: s.model,
    originator: originator,
    topic: topic,
    metrics: {
      burnRate: burnRate,
      toolCalls: 0,
      minutesActive: Math.max(1, Math.min(Math.round(minutesAgo), 24 * 60)),
    },
  };
}

// Extract JSON from CLI output that may contain doctor warnings or other prefix text
function extractJSON(output) {
  if (!output) return null;
  // Find the first { or [ which starts the JSON
  const jsonStart = output.search(/[[{]/);
  if (jsonStart === -1) return null;
  return output.slice(jsonStart);
}

// Topic patterns for session classification
// Each topic maps to an array of keywords - more specific keywords = higher relevance
const TOPIC_PATTERNS = {
  // Core system topics
  dashboard: ["dashboard", "command center", "ui", "interface", "status page"],
  scheduling: ["cron", "schedule", "timer", "reminder", "alarm", "periodic", "interval"],
  heartbeat: [
    "heartbeat",
    "heartbeat_ok",
    "poll",
    "health check",
    "ping",
    "keepalive",
    "monitoring",
  ],
  memory: ["memory", "remember", "recall", "notes", "journal", "log", "context"],

  // Communication channels
  Slack: ["slack", "channel", "#cc-", "thread", "mention", "dm", "workspace"],
  email: ["email", "mail", "inbox", "gmail", "send email", "unread", "compose"],
  calendar: ["calendar", "event", "meeting", "appointment", "schedule", "gcal"],

  // Development topics
  coding: [
    "code",
    "script",
    "function",
    "debug",
    "error",
    "bug",
    "implement",
    "refactor",
    "programming",
  ],
  git: [
    "git",
    "commit",
    "branch",
    "merge",
    "push",
    "pull",
    "repository",
    "pr",
    "pull request",
    "github",
  ],
  "file editing": ["file", "edit", "write", "read", "create", "delete", "modify", "save"],
  API: ["api", "endpoint", "request", "response", "webhook", "integration", "rest", "graphql"],

  // Research & web
  research: ["search", "research", "lookup", "find", "investigate", "learn", "study"],
  browser: ["browser", "webpage", "website", "url", "click", "navigate", "screenshot", "web_fetch"],
  "Quip export": ["quip", "export", "document", "spreadsheet"],

  // Domain-specific
  finance: ["finance", "investment", "stock", "money", "budget", "bank", "trading", "portfolio"],
  home: ["home", "automation", "lights", "thermostat", "smart home", "iot", "homekit"],
  health: ["health", "fitness", "workout", "exercise", "weight", "sleep", "nutrition"],
  travel: ["travel", "flight", "hotel", "trip", "vacation", "booking", "airport"],
  food: ["food", "recipe", "restaurant", "cooking", "meal", "order", "delivery"],

  // Agent operations
  subagent: ["subagent", "spawn", "sub-agent", "delegate", "worker", "parallel"],
  tools: ["tool", "exec", "shell", "command", "terminal", "bash", "run"],
};

/**
 * Detect topics from text content
 * @param {string} text - Text to analyze
 * @returns {string[]} - Array of detected topics (may be empty)
 */
function detectTopics(text) {
  if (!text) return [];
  const lowerText = text.toLowerCase();

  // Score each topic based on keyword matches
  const scores = {};
  for (const [topic, keywords] of Object.entries(TOPIC_PATTERNS)) {
    let score = 0;
    for (const keyword of keywords) {
      // Check for keyword presence (word boundary aware for short keywords)
      if (keyword.length <= 3) {
        // Short keywords need word boundaries to avoid false positives
        const regex = new RegExp(`\\b${keyword}\\b`, "i");
        if (regex.test(lowerText)) score++;
      } else if (lowerText.includes(keyword)) {
        score++;
      }
    }
    if (score > 0) {
      scores[topic] = score;
    }
  }

  // No matches
  if (Object.keys(scores).length === 0) return [];

  // Find best score
  const bestScore = Math.max(...Object.values(scores));

  // Include all topics with score >= 2 OR >= 50% of best score
  const threshold = Math.max(2, bestScore * 0.5);

  return Object.entries(scores)
    .filter(([_, score]) => score >= threshold || (score >= 1 && bestScore <= 2))
    .sort((a, b) => b[1] - a[1])
    .map(([topic, _]) => topic);
}

// Channel ID to name mapping (auto-populated from Slack)
const CHANNEL_MAP = {
  c0aax7y80np: "#cc-meta",
  c0ab9f8sdfe: "#cc-research",
  c0aan4rq7v5: "#cc-finance",
  c0abxulk1qq: "#cc-properties",
  c0ab5nz8mkl: "#cc-ai",
  c0aan38tzv5: "#cc-dev",
  c0ab7wwhqvc: "#cc-home",
  c0ab1pjhxef: "#cc-health",
  c0ab7txvcqd: "#cc-legal",
  c0aay2g3n3r: "#cc-social",
  c0aaxrw2wqp: "#cc-business",
  c0ab19f3lae: "#cc-random",
  c0ab0r74y33: "#cc-food",
  c0ab0qrq3r9: "#cc-travel",
  c0ab0sbqqlg: "#cc-family",
  c0ab0slqdba: "#cc-games",
  c0ab1ps7ef2: "#cc-music",
  c0absbnrsbe: "#cc-dashboard",
};

// Parse session key into readable label
function parseSessionLabel(key) {
  // Pattern: agent:main:slack:channel:CHANNEL_ID:thread:TIMESTAMP
  // or: agent:main:slack:channel:CHANNEL_ID
  // or: agent:main:main (telegram main)

  const parts = key.split(":");

  if (parts.includes("slack")) {
    const channelIdx = parts.indexOf("channel");
    if (channelIdx >= 0 && parts[channelIdx + 1]) {
      const channelId = parts[channelIdx + 1].toLowerCase();
      const channelName = CHANNEL_MAP[channelId] || `#${channelId}`;

      // Check if it's a thread
      if (parts.includes("thread")) {
        const threadTs = parts[parts.indexOf("thread") + 1];
        // Convert timestamp to rough time
        const ts = parseFloat(threadTs);
        const date = new Date(ts * 1000);
        const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        return `${channelName} thread @ ${timeStr}`;
      }
      return channelName;
    }
  }

  if (key.includes("telegram")) {
    return "📱 Telegram";
  }

  if (key === "agent:main:main") {
    return "🏠 Main Session";
  }

  // Fallback: truncate key
  return key.length > 40 ? key.slice(0, 37) + "..." : key;
}

// Get sessions data
/**
 * Get quick topic for a session by reading first portion of transcript
 * @param {string} sessionId - Session ID
 * @returns {string|null} - Primary topic or null
 */
function getSessionTopic(sessionId) {
  if (!sessionId) return null;
  try {
    const openclawDir = getOpenClawDir();
    const transcriptPath = path.join(
      openclawDir,
      "agents",
      "main",
      "sessions",
      `${sessionId}.jsonl`,
    );
    if (!fs.existsSync(transcriptPath)) return null;

    // Read first 50KB of transcript (enough for topic detection, fast)
    const fd = fs.openSync(transcriptPath, "r");
    const buffer = Buffer.alloc(50000);
    const bytesRead = fs.readSync(fd, buffer, 0, 50000, 0);
    fs.closeSync(fd);

    if (bytesRead === 0) return null;

    const content = buffer.toString("utf8", 0, bytesRead);
    const lines = content.split("\n").filter((l) => l.trim());

    // Extract text from messages
    // Transcript format: {type: "message", message: {role: "user"|"assistant", content: [...]}}
    let textSamples = [];
    for (const line of lines.slice(0, 30)) {
      // First 30 entries
      try {
        const entry = JSON.parse(line);
        if (entry.type === "message" && entry.message?.content) {
          const msgContent = entry.message.content;
          if (Array.isArray(msgContent)) {
            msgContent.forEach((c) => {
              if (c.type === "text" && c.text) {
                textSamples.push(c.text.slice(0, 500));
              }
            });
          } else if (typeof msgContent === "string") {
            textSamples.push(msgContent.slice(0, 500));
          }
        }
      } catch (e) {
        /* skip malformed lines */
      }
    }

    if (textSamples.length === 0) return null;

    const topics = detectTopics(textSamples.join(" "));
    return topics.length > 0 ? topics.slice(0, 2).join(", ") : null;
  } catch (e) {
    return null;
  }
}

function getSessions(options = {}) {
  const limit = Object.prototype.hasOwnProperty.call(options, "limit") ? options.limit : 20;
  const returnCount = options.returnCount || false;

  // For "get all" requests (limit: null), use the async cache
  // This is the expensive operation that was blocking
  if (limit === null) {
    const cached = getSessionsCached();
    const totalCount = cached.length;
    return returnCount ? { sessions: cached, totalCount } : cached;
  }

  // For limited requests, can still use sync (fast enough)
  try {
    const output = runOpenClaw("sessions list --json 2>/dev/null");
    const jsonStr = extractJSON(output);
    if (jsonStr) {
      const data = JSON.parse(jsonStr);
      const totalCount = data.count || data.sessions?.length || 0;
      let sessions = data.sessions || [];
      if (limit != null) {
        sessions = sessions.slice(0, limit);
      }
      const mapped = sessions.map((s) => mapSession(s));
      return returnCount ? { sessions: mapped, totalCount } : mapped;
    }
  } catch (e) {
    console.error("Failed to get sessions:", e.message);
  }
  return returnCount ? { sessions: [], totalCount: 0 } : [];
}

// Get cron jobs
// Convert cron expression to human-readable text
function cronToHuman(expr) {
  if (!expr || expr === "—") return null;

  const parts = expr.split(" ");
  if (parts.length < 5) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Helper to format time
  function formatTime(h, m) {
    const hNum = parseInt(h, 10);
    const mNum = parseInt(m, 10);
    if (isNaN(hNum)) return null;
    const ampm = hNum >= 12 ? "pm" : "am";
    const h12 = hNum === 0 ? 12 : hNum > 12 ? hNum - 12 : hNum;
    return mNum === 0 ? `${h12}${ampm}` : `${h12}:${mNum.toString().padStart(2, "0")}${ampm}`;
  }

  // Every minute
  if (minute === "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return "Every minute";
  }

  // Every X minutes
  if (minute.startsWith("*/")) {
    const interval = minute.slice(2);
    return `Every ${interval} minutes`;
  }

  // Every X hours (*/N in hour field)
  if (hour.startsWith("*/")) {
    const interval = hour.slice(2);
    const minStr = minute === "0" ? "" : `:${minute.padStart(2, "0")}`;
    return `Every ${interval} hours${minStr ? " at " + minStr : ""}`;
  }

  // Every hour at specific minute
  if (minute !== "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Hourly at :${minute.padStart(2, "0")}`;
  }

  // Build time string for specific hour
  let timeStr = "";
  if (minute !== "*" && hour !== "*" && !hour.startsWith("*/")) {
    timeStr = formatTime(hour, minute);
  }

  // Daily at specific time
  if (timeStr && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Daily at ${timeStr}`;
  }

  // Weekdays (Mon-Fri) - check before generic day of week
  if ((dayOfWeek === "1-5" || dayOfWeek === "MON-FRI") && dayOfMonth === "*" && month === "*") {
    return timeStr ? `Weekdays at ${timeStr}` : "Weekdays";
  }

  // Weekends - check before generic day of week
  if ((dayOfWeek === "0,6" || dayOfWeek === "6,0") && dayOfMonth === "*" && month === "*") {
    return timeStr ? `Weekends at ${timeStr}` : "Weekends";
  }

  // Specific day of week
  if (dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
    const days = dayOfWeek.split(",").map((d) => {
      const num = parseInt(d, 10);
      return dayNames[num] || d;
    });
    const dayStr = days.length === 1 ? days[0] : days.join(", ");
    return timeStr ? `${dayStr} at ${timeStr}` : `Every ${dayStr}`;
  }

  // Specific day of month
  if (dayOfMonth !== "*" && month === "*" && dayOfWeek === "*") {
    const day = parseInt(dayOfMonth, 10);
    const suffix =
      day === 1 || day === 21 || day === 31
        ? "st"
        : day === 2 || day === 22
          ? "nd"
          : day === 3 || day === 23
            ? "rd"
            : "th";
    return timeStr ? `${day}${suffix} of month at ${timeStr}` : `${day}${suffix} of every month`;
  }

  // Fallback: just show the time if we have it
  if (timeStr) {
    return `At ${timeStr}`;
  }

  return expr; // Return original as fallback
}

// Get cron jobs - reads directly from file for speed (CLI takes 11s+)
function getCronJobs() {
  try {
    const cronPath = path.join(getOpenClawDir(), "cron", "jobs.json");
    if (fs.existsSync(cronPath)) {
      const data = JSON.parse(fs.readFileSync(cronPath, "utf8"));
      return (data.jobs || []).map((j) => {
        // Parse schedule
        let scheduleStr = "—";
        let scheduleHuman = null;
        if (j.schedule) {
          if (j.schedule.kind === "cron" && j.schedule.expr) {
            scheduleStr = j.schedule.expr;
            scheduleHuman = cronToHuman(j.schedule.expr);
          } else if (j.schedule.kind === "once") {
            scheduleStr = "once";
            scheduleHuman = "One-time";
          }
        }

        // Format next run
        let nextRunStr = "—";
        if (j.state?.nextRunAtMs) {
          const next = new Date(j.state.nextRunAtMs);
          const now = new Date();
          const diffMs = next - now;
          const diffMins = Math.round(diffMs / 60000);
          if (diffMins < 0) {
            nextRunStr = "overdue";
          } else if (diffMins < 60) {
            nextRunStr = `${diffMins}m`;
          } else if (diffMins < 1440) {
            nextRunStr = `${Math.round(diffMins / 60)}h`;
          } else {
            nextRunStr = `${Math.round(diffMins / 1440)}d`;
          }
        }

        return {
          id: j.id,
          name: j.name || j.id.slice(0, 8),
          schedule: scheduleStr,
          scheduleHuman: scheduleHuman,
          nextRun: nextRunStr,
          enabled: j.enabled !== false,
          lastStatus: j.state?.lastStatus,
        };
      });
    }
  } catch (e) {
    console.error("Failed to get cron:", e.message);
  }
  return [];
}

// Get system status
function getSystemStatus() {
  const hostname = execSync("hostname", { encoding: "utf8" }).trim();
  let uptime = "—";
  try {
    const uptimeRaw = execSync("uptime", { encoding: "utf8" });
    const match = uptimeRaw.match(/up\s+([^,]+)/);
    if (match) uptime = match[1].trim();
  } catch (e) {}

  let gateway = "Unknown";
  try {
    const status = runOpenClaw("gateway status 2>/dev/null");
    if (status && status.includes("running")) {
      gateway = "Running";
    } else if (status && status.includes("stopped")) {
      gateway = "Stopped";
    }
  } catch (e) {}

  return {
    hostname,
    gateway,
    model: "claude-opus-4-5",
    uptime,
  };
}

// Get recent activity from memory files
function getRecentActivity() {
  const activities = [];
  const today = new Date().toISOString().split("T")[0];
  const memoryFile = path.join(PATHS.memory, `${today}.md`);

  try {
    if (fs.existsSync(memoryFile)) {
      const content = fs.readFileSync(memoryFile, "utf8");
      const lines = content.split("\n").filter((l) => l.startsWith("- "));
      lines.slice(-5).forEach((line) => {
        const text = line.replace(/^- /, "").slice(0, 80);
        activities.push({
          icon: text.includes("✅") ? "✅" : text.includes("❌") ? "❌" : "📝",
          text: text.replace(/[✅❌📝🔧]/g, "").trim(),
          time: today,
        });
      });
    }
  } catch (e) {
    console.error("Failed to read activity:", e.message);
  }

  return activities.reverse();
}

// Get capacity info from gateway config and active sessions
function getCapacity() {
  const result = {
    main: { active: 0, max: 12 },
    subagent: { active: 0, max: 24 },
  };

  // Determine OpenClaw directory (respects OPENCLAW_PROFILE)
  const openclawDir = getOpenClawDir();

  // Read max capacity from openclaw config
  try {
    const configPath = path.join(openclawDir, "openclaw.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (config?.agents?.defaults?.maxConcurrent) {
        result.main.max = config.agents.defaults.maxConcurrent;
      }
      if (config?.agents?.defaults?.subagents?.maxConcurrent) {
        result.subagent.max = config.agents.defaults.subagents.maxConcurrent;
      }
    }
  } catch (e) {
    // Fall back to defaults
  }

  // Try to get active counts from sessions list (preferred - has full session keys)
  try {
    const output = runOpenClaw("sessions list --json 2>/dev/null");
    const jsonStr = extractJSON(output);
    if (jsonStr) {
      const data = JSON.parse(jsonStr);
      const sessions = data.sessions || [];
      const fiveMinMs = 5 * 60 * 1000;

      for (const s of sessions) {
        // Only count sessions active in last 5 minutes
        if (s.ageMs > fiveMinMs) continue;

        const key = s.key || "";
        // Session key patterns:
        //   agent:main:slack:... = main (human-initiated)
        //   agent:main:telegram:... = main
        //   agent:main:discord:... = main
        //   agent:main:subagent:... = subagent (spawned task)
        //   agent:main:cron:... = cron job (count as subagent)
        if (key.includes(":subagent:") || key.includes(":cron:")) {
          result.subagent.active++;
        } else {
          result.main.active++;
        }
      }
      return result;
    }
  } catch (e) {
    console.error(
      "Failed to get capacity from sessions list, falling back to filesystem:",
      e.message,
    );
  }

  // Count active sessions from filesystem (workaround for CLI returning styled text)
  // Sessions active in last 5 minutes are considered "active"
  try {
    const sessionsDir = path.join(openclawDir, "agents", "main", "sessions");
    if (fs.existsSync(sessionsDir)) {
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));

      let mainActive = 0;
      let subActive = 0;

      for (const file of files) {
        try {
          const filePath = path.join(sessionsDir, file);
          const stat = fs.statSync(filePath);

          // Only count files modified in last 5 minutes as "active"
          if (stat.mtimeMs < fiveMinAgo) continue;

          // Read the first line to get the session key
          // Session keys indicate session type:
          //   agent:main:slack:... = main (human-initiated slack)
          //   agent:main:telegram:... = main (human-initiated telegram)
          //   agent:main:discord:... = main (human-initiated discord)
          //   agent:main:subagent:... = subagent (spawned autonomous task)
          //   agent:main:cron:... = cron job (automated, count as subagent)
          // Filenames are just UUIDs, so we must read the content
          let isSubagent = false;
          try {
            const fd = fs.openSync(filePath, "r");
            const buffer = Buffer.alloc(512); // First 512 bytes is enough for the first line
            fs.readSync(fd, buffer, 0, 512, 0);
            fs.closeSync(fd);
            const firstLine = buffer.toString("utf8").split("\n")[0];
            const parsed = JSON.parse(firstLine);
            const key = parsed.key || parsed.id || "";
            // Subagent and cron sessions are not human-initiated
            isSubagent = key.includes(":subagent:") || key.includes(":cron:");
          } catch (parseErr) {
            // If we can't parse, fall back to checking filename (legacy)
            isSubagent = file.includes("subagent");
          }

          if (isSubagent) {
            subActive++;
          } else {
            mainActive++;
          }
        } catch (e) {
          // Skip unreadable files
        }
      }

      result.main.active = mainActive;
      result.subagent.active = subActive;
    }
  } catch (e) {
    console.error("Failed to count active sessions from filesystem:", e.message);
  }

  return result;
}

// Get memory stats
function getMemoryStats() {
  const memoryDir = PATHS.memory;
  const memoryFile = path.join(PATHS.workspace, "MEMORY.md");

  const stats = {
    totalFiles: 0,
    totalSize: 0,
    totalSizeFormatted: "0 B",
    memoryMdSize: 0,
    memoryMdSizeFormatted: "0 B",
    memoryMdLines: 0,
    recentFiles: [],
    oldestFile: null,
    newestFile: null,
  };

  try {
    const collectMemoryFiles = (dir, baseDir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files = [];

      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...collectMemoryFiles(entryPath, baseDir));
        } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".json"))) {
          const stat = fs.statSync(entryPath);
          const relativePath = path.relative(baseDir, entryPath);
          files.push({
            name: relativePath,
            size: stat.size,
            sizeFormatted: formatBytes(stat.size),
            modified: stat.mtime,
          });
        }
      }

      return files;
    };

    // MEMORY.md stats
    if (fs.existsSync(memoryFile)) {
      const memStat = fs.statSync(memoryFile);
      stats.memoryMdSize = memStat.size;
      stats.memoryMdSizeFormatted = formatBytes(memStat.size);
      const content = fs.readFileSync(memoryFile, "utf8");
      stats.memoryMdLines = content.split("\n").length;
      stats.totalSize += memStat.size;
      stats.totalFiles++;
    }

    // Memory directory stats
    if (fs.existsSync(memoryDir)) {
      const files = collectMemoryFiles(memoryDir, memoryDir).sort(
        (a, b) => b.modified - a.modified,
      );

      stats.totalFiles += files.length;
      files.forEach((f) => (stats.totalSize += f.size));
      stats.recentFiles = files.slice(0, 5).map((f) => ({
        name: f.name,
        sizeFormatted: f.sizeFormatted,
        age: formatTimeAgo(f.modified),
      }));

      if (files.length > 0) {
        stats.newestFile = files[0].name;
        stats.oldestFile = files[files.length - 1].name;
      }
    }

    stats.totalSizeFormatted = formatBytes(stats.totalSize);
  } catch (e) {
    console.error("Failed to get memory stats:", e.message);
  }

  return stats;
}

// Get all data for dashboard
function getData() {
  // Get ALL sessions for accurate counts, then slice for display
  const allSessions = getSessions({ limit: null });
  const pageSize = 20;
  const displaySessions = allSessions.slice(0, pageSize);
  const tokenStats = getTokenStats(allSessions);
  const capacity = getCapacity();
  const memory = getMemoryStats();

  // Calculate status counts based on ALL sessions (not just current page)
  const statusCounts = {
    all: allSessions.length,
    live: allSessions.filter((s) => s.active).length,
    recent: allSessions.filter((s) => !s.active && s.recentlyActive).length,
    idle: allSessions.filter((s) => !s.active && !s.recentlyActive).length,
  };

  // Calculate real pagination
  const totalPages = Math.ceil(allSessions.length / pageSize);

  return {
    sessions: displaySessions,
    tokenStats: tokenStats,
    capacity: capacity,
    memory: memory,
    pagination: {
      page: 1,
      pageSize: pageSize,
      total: allSessions.length,
      totalPages: totalPages,
      hasPrev: false,
      hasNext: totalPages > 1,
    },
    statusCounts: statusCounts,
  };
}

// ============================================================================
// UNIFIED STATE (Single source of truth for all dashboard data)
// ============================================================================

let cachedState = null;
let lastStateUpdate = 0;
const STATE_CACHE_TTL = 30000; // 30 seconds - reduce blocking from CLI calls

function getFullState() {
  const now = Date.now();

  // Return cached state if fresh
  if (cachedState && now - lastStateUpdate < STATE_CACHE_TTL) {
    return cachedState;
  }

  // Gather all data with error handling for each section
  let sessions = [];
  let tokenStats = {};
  let statusCounts = { all: 0, live: 0, recent: 0, idle: 0 };
  let vitals = {};
  let capacity = {};
  let operators = { operators: [], roles: {} };
  let llmUsage = {};
  let cron = [];
  let memory = {};
  let cerebro = {};
  let subagents = [];

  // Get ALL sessions first for accurate statusCounts, then slice for display
  let allSessions = [];
  let totalSessionCount = 0;
  try {
    allSessions = getSessions({ limit: null }); // Get all for counting
    totalSessionCount = allSessions.length;
    sessions = allSessions.slice(0, 20); // Display only first 20
  } catch (e) {
    console.error("[State] sessions:", e.message);
  }

  try {
    vitals = getSystemVitals();
  } catch (e) {
    console.error("[State] vitals:", e.message);
  }
  // Use filesystem-based capacity (no CLI calls, won't block)
  try {
    capacity = getCapacity();
  } catch (e) {
    console.error("[State] capacity:", e.message);
  }
  // Pass capacity to tokenStats so it can use the same active counts
  try {
    tokenStats = getTokenStats(sessions, capacity);
  } catch (e) {
    console.error("[State] tokenStats:", e.message);
  }
  // Calculate statusCounts from ALL sessions (not just current page) for accurate filter counts
  try {
    const liveSessions = allSessions.filter((s) => s.active);
    const recentSessions = allSessions.filter((s) => !s.active && s.recentlyActive);
    const idleSessions = allSessions.filter((s) => !s.active && !s.recentlyActive);
    statusCounts = {
      all: totalSessionCount,
      live: liveSessions.length,
      recent: recentSessions.length,
      idle: idleSessions.length,
    };
  } catch (e) {
    console.error("[State] statusCounts:", e.message);
  }
  try {
    const operatorData = loadOperators();
    // Add stats to each operator (same as /api/operators endpoint)
    const operatorsWithStats = operatorData.operators.map((op) => {
      const userSessions = allSessions.filter(
        (s) => s.originator?.userId === op.id || s.originator?.userId === op.metadata?.slackId,
      );
      return {
        ...op,
        stats: {
          activeSessions: userSessions.filter((s) => s.active).length,
          totalSessions: userSessions.length,
          lastSeen:
            userSessions.length > 0
              ? new Date(
                  Date.now() - Math.min(...userSessions.map((s) => s.minutesAgo)) * 60000,
                ).toISOString()
              : op.lastSeen,
        },
      };
    });
    operators = { ...operatorData, operators: operatorsWithStats };
  } catch (e) {
    console.error("[State] operators:", e.message);
  }
  try {
    llmUsage = getLlmUsage();
  } catch (e) {
    console.error("[State] llmUsage:", e.message);
  }
  try {
    cron = getCronJobs();
  } catch (e) {
    console.error("[State] cron:", e.message);
  }
  try {
    memory = getMemoryStats();
  } catch (e) {
    console.error("[State] memory:", e.message);
  }
  try {
    cerebro = getCerebroTopics();
  } catch (e) {
    console.error("[State] cerebro:", e.message);
  }
  // Derive subagents from allSessions (no extra CLI call needed)
  // Configurable retention: SUBAGENT_RETENTION_HOURS env var (default 24h)
  try {
    const retentionHours = parseInt(process.env.SUBAGENT_RETENTION_HOURS || "12", 10);
    const retentionMs = retentionHours * 60 * 60 * 1000;
    subagents = allSessions
      .filter((s) => s.sessionKey && s.sessionKey.includes(":subagent:"))
      .filter((s) => (s.minutesAgo || 0) * 60000 < retentionMs)
      .map((s) => {
        const match = s.sessionKey.match(/:subagent:([a-f0-9-]+)$/);
        const subagentId = match ? match[1] : s.sessionId;
        return {
          id: subagentId,
          shortId: subagentId.slice(0, 8),
          task: s.label || s.displayName || "Sub-agent task",
          tokens: s.tokens || 0,
          ageMs: (s.minutesAgo || 0) * 60000,
          active: s.active,
          recentlyActive: s.recentlyActive,
        };
      });
  } catch (e) {
    console.error("[State] subagents:", e.message);
  }

  cachedState = {
    vitals,
    sessions,
    tokenStats,
    statusCounts,
    capacity,
    operators,
    llmUsage,
    cron,
    memory,
    cerebro,
    subagents,
    pagination: {
      page: 1,
      pageSize: 20,
      total: totalSessionCount,
      totalPages: Math.max(1, Math.ceil(totalSessionCount / 20)),
      hasPrev: false,
      hasNext: totalSessionCount > 20,
    },
    timestamp: now,
  };

  lastStateUpdate = now;
  return cachedState;
}

// Force refresh the cached state
function refreshState() {
  lastStateUpdate = 0;
  return getFullState();
}

// Background state refresh and SSE broadcast
let stateRefreshInterval = null;

function startStateRefresh(intervalMs = 30000) {
  if (stateRefreshInterval) return;

  stateRefreshInterval = setInterval(() => {
    try {
      const newState = refreshState();
      broadcastSSE("update", newState);
    } catch (e) {
      console.error("[State] Refresh error:", e.message);
    }
  }, intervalMs);

  console.log(`[State] Background refresh started (${intervalMs}ms interval)`);
}

function stopStateRefresh() {
  if (stateRefreshInterval) {
    clearInterval(stateRefreshInterval);
    stateRefreshInterval = null;
    console.log("[State] Background refresh stopped");
  }
}

// Get token usage from JSONL session files (accurate aggregation)
// Tracks 24h, 3-day, and 7-day moving averages
// Token usage cache with async background refresh
let tokenUsageCache = { data: null, timestamp: 0, refreshing: false };
const TOKEN_USAGE_CACHE_TTL = 30000; // 30 seconds

// Create empty usage bucket
function emptyUsageBucket() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, requests: 0 };
}

// Async token usage refresh - runs in background, doesn't block
async function refreshTokenUsageAsync() {
  if (tokenUsageCache.refreshing) return;
  tokenUsageCache.refreshing = true;

  try {
    const sessionsDir = path.join(getOpenClawDir(), "agents", "main", "sessions");
    const files = await fs.promises.readdir(sessionsDir);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    // Track usage for each time window
    const usage24h = emptyUsageBucket();
    const usage3d = emptyUsageBucket();
    const usage7d = emptyUsageBucket();

    // Process files in batches to avoid overwhelming the system
    const batchSize = 50;
    for (let i = 0; i < jsonlFiles.length; i += batchSize) {
      const batch = jsonlFiles.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (file) => {
          const filePath = path.join(sessionsDir, file);
          try {
            const stat = await fs.promises.stat(filePath);
            // Skip files not modified in the last 7 days
            if (stat.mtimeMs < sevenDaysAgo) return;

            const content = await fs.promises.readFile(filePath, "utf8");
            const lines = content.trim().split("\n");

            for (const line of lines) {
              if (!line) continue;
              try {
                const entry = JSON.parse(line);
                const entryTime = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;

                // Skip entries older than 7 days
                if (entryTime < sevenDaysAgo) continue;

                if (entry.message?.usage) {
                  const u = entry.message.usage;
                  const input = u.input || 0;
                  const output = u.output || 0;
                  const cacheRead = u.cacheRead || 0;
                  const cacheWrite = u.cacheWrite || 0;
                  const cost = u.cost?.total || 0;

                  // Add to appropriate buckets (cumulative - 24h is subset of 3d is subset of 7d)
                  if (entryTime >= oneDayAgo) {
                    usage24h.input += input;
                    usage24h.output += output;
                    usage24h.cacheRead += cacheRead;
                    usage24h.cacheWrite += cacheWrite;
                    usage24h.cost += cost;
                    usage24h.requests++;
                  }
                  if (entryTime >= threeDaysAgo) {
                    usage3d.input += input;
                    usage3d.output += output;
                    usage3d.cacheRead += cacheRead;
                    usage3d.cacheWrite += cacheWrite;
                    usage3d.cost += cost;
                    usage3d.requests++;
                  }
                  // Always add to 7d (already filtered above)
                  usage7d.input += input;
                  usage7d.output += output;
                  usage7d.cacheRead += cacheRead;
                  usage7d.cacheWrite += cacheWrite;
                  usage7d.cost += cost;
                  usage7d.requests++;
                }
              } catch (e) {
                // Skip invalid lines
              }
            }
          } catch (e) {
            // Skip unreadable files
          }
        }),
      );

      // Yield to event loop between batches
      await new Promise((resolve) => setImmediate(resolve));
    }

    // Helper to finalize bucket with computed fields
    const finalizeBucket = (bucket) => ({
      ...bucket,
      tokensNoCache: bucket.input + bucket.output,
      tokensWithCache: bucket.input + bucket.output + bucket.cacheRead + bucket.cacheWrite,
    });

    const result = {
      // Primary (24h) for backward compatibility
      ...finalizeBucket(usage24h),
      // All three windows
      windows: {
        "24h": finalizeBucket(usage24h),
        "3d": finalizeBucket(usage3d),
        "7d": finalizeBucket(usage7d),
      },
    };

    tokenUsageCache = { data: result, timestamp: Date.now(), refreshing: false };
    console.log(
      `[Token Usage] Cached: 24h=${usage24h.requests} 3d=${usage3d.requests} 7d=${usage7d.requests} requests`,
    );
  } catch (e) {
    console.error("[Token Usage] Refresh error:", e.message);
    tokenUsageCache.refreshing = false;
  }
}

// Returns cached token usage, triggers async refresh if stale
function getDailyTokenUsage() {
  const now = Date.now();
  const isStale = now - tokenUsageCache.timestamp > TOKEN_USAGE_CACHE_TTL;

  // Trigger async refresh if stale (don't await)
  if (isStale && !tokenUsageCache.refreshing) {
    refreshTokenUsageAsync();
  }

  const emptyResult = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    requests: 0,
    tokensNoCache: 0,
    tokensWithCache: 0,
    windows: {
      "24h": {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
        requests: 0,
        tokensNoCache: 0,
        tokensWithCache: 0,
      },
      "3d": {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
        requests: 0,
        tokensNoCache: 0,
        tokensWithCache: 0,
      },
      "7d": {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
        requests: 0,
        tokensNoCache: 0,
        tokensWithCache: 0,
      },
    },
  };

  // Always return cache (may be stale or null on cold start)
  return tokenUsageCache.data || emptyResult;
}

// Claude Opus 4 pricing (per 1M tokens) - shared across functions
const TOKEN_RATES = {
  input: 15.0, // $15/1M input tokens
  output: 75.0, // $75/1M output tokens
  cacheRead: 1.5, // $1.50/1M (90% discount from input)
  cacheWrite: 18.75, // $18.75/1M (25% premium on input)
};

// Calculate cost for a usage bucket
function calculateCostForBucket(bucket, rates = TOKEN_RATES) {
  const inputCost = (bucket.input / 1_000_000) * rates.input;
  const outputCost = (bucket.output / 1_000_000) * rates.output;
  const cacheReadCost = (bucket.cacheRead / 1_000_000) * rates.cacheRead;
  const cacheWriteCost = (bucket.cacheWrite / 1_000_000) * rates.cacheWrite;
  return {
    inputCost,
    outputCost,
    cacheReadCost,
    cacheWriteCost,
    totalCost: inputCost + outputCost + cacheReadCost + cacheWriteCost,
  };
}

// Get detailed cost breakdown for the modal
function getCostBreakdown() {
  const usage = getDailyTokenUsage();
  if (!usage) {
    return { error: "Failed to get usage data" };
  }

  // Calculate costs for 24h (primary display)
  const costs = calculateCostForBucket(usage);

  // Get plan info from config
  const planCost = CONFIG.billing?.claudePlanCost || 200;
  const planName = CONFIG.billing?.claudePlanName || "Claude Code Max";

  // Calculate moving averages for each window
  const windowConfigs = {
    "24h": { days: 1, label: "24h" },
    "3d": { days: 3, label: "3dma" },
    "7d": { days: 7, label: "7dma" },
  };

  const windows = {};
  for (const [key, config] of Object.entries(windowConfigs)) {
    const bucket = usage.windows?.[key] || usage;
    const bucketCosts = calculateCostForBucket(bucket);
    const dailyAvg = bucketCosts.totalCost / config.days;
    const monthlyProjected = dailyAvg * 30;
    const monthlySavings = monthlyProjected - planCost;

    windows[key] = {
      label: config.label,
      days: config.days,
      totalCost: bucketCosts.totalCost,
      dailyAvg,
      monthlyProjected,
      monthlySavings,
      savingsPercent:
        monthlySavings > 0 ? Math.round((monthlySavings / monthlyProjected) * 100) : 0,
      requests: bucket.requests,
      tokens: {
        input: bucket.input,
        output: bucket.output,
        cacheRead: bucket.cacheRead,
        cacheWrite: bucket.cacheWrite,
      },
    };
  }

  return {
    // Raw token counts (24h for backward compatibility)
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    requests: usage.requests,

    // Pricing rates
    rates: {
      input: TOKEN_RATES.input.toFixed(2),
      output: TOKEN_RATES.output.toFixed(2),
      cacheRead: TOKEN_RATES.cacheRead.toFixed(2),
      cacheWrite: TOKEN_RATES.cacheWrite.toFixed(2),
    },

    // Cost calculation breakdown (24h)
    calculation: {
      inputCost: costs.inputCost,
      outputCost: costs.outputCost,
      cacheReadCost: costs.cacheReadCost,
      cacheWriteCost: costs.cacheWriteCost,
    },

    // Totals (24h for backward compatibility)
    totalCost: costs.totalCost,
    planCost,
    planName,

    // Period
    period: "24 hours",

    // Multi-window data for moving averages
    windows,

    // Top sessions by tokens
    topSessions: getTopSessionsByTokens(5),
  };
}

// Get top sessions sorted by token usage
function getTopSessionsByTokens(limit = 5) {
  try {
    const sessions = getSessions({ limit: null });
    return sessions
      .filter((s) => s.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, limit)
      .map((s) => ({
        label: s.label,
        tokens: s.tokens,
        channel: s.channel,
        active: s.active,
      }));
  } catch (e) {
    console.error("[TopSessions] Error:", e.message);
    return [];
  }
}

// Calculate aggregate token stats
// Accepts optional capacity data to avoid redundant filesystem scans
function getTokenStats(sessions, capacity) {
  // Use capacity data if provided, otherwise compute from sessions
  let activeMainCount = capacity?.main?.active ?? 0;
  let activeSubagentCount = capacity?.subagent?.active ?? 0;
  let activeCount = activeMainCount + activeSubagentCount;
  let mainLimit = capacity?.main?.max ?? 12;
  let subagentLimit = capacity?.subagent?.max ?? 24;

  // Fallback: count from sessions if capacity not provided
  if (!capacity && sessions && sessions.length > 0) {
    activeCount = 0;
    activeMainCount = 0;
    activeSubagentCount = 0;
    sessions.forEach((s) => {
      if (s.active) {
        activeCount++;
        if (s.key && s.key.includes(":subagent:")) {
          activeSubagentCount++;
        } else {
          activeMainCount++;
        }
      }
    });
  }

  // Get accurate usage from JSONL files (includes all windows)
  const usage = getDailyTokenUsage();
  const totalInput = usage?.input || 0;
  const totalOutput = usage?.output || 0;
  const total = totalInput + totalOutput;

  // Calculate cost using shared helper
  const costs = calculateCostForBucket(usage);
  const estCost = costs.totalCost;

  // Calculate savings vs plan cost (compare monthly to monthly)
  const planCost = CONFIG.billing?.claudePlanCost || 200;
  const planName = CONFIG.billing?.claudePlanName || "Claude Code Max";
  const monthlyApiCost = estCost * 30; // Project daily to monthly
  const monthlySavings = monthlyApiCost - planCost;
  const savingsPositive = monthlySavings > 0;

  // Calculate per-session averages
  const sessionCount = sessions?.length || 1;
  const avgTokensPerSession = Math.round(total / sessionCount);
  const avgCostPerSession = estCost / sessionCount;

  // Calculate savings for all windows (24h, 3dma, 7dma)
  const windowConfigs = {
    "24h": { days: 1, label: "24h" },
    "3dma": { days: 3, label: "3dma" },
    "7dma": { days: 7, label: "7dma" },
  };

  const savingsWindows = {};
  for (const [key, config] of Object.entries(windowConfigs)) {
    // Map '3dma' -> '3d' for bucket lookup
    const bucketKey = key.replace("dma", "d").replace("24h", "24h");
    const bucket = usage.windows?.[bucketKey === "24h" ? "24h" : bucketKey] || usage;
    const bucketCosts = calculateCostForBucket(bucket);
    const dailyAvg = bucketCosts.totalCost / config.days;
    const monthlyProjected = dailyAvg * 30;
    const windowSavings = monthlyProjected - planCost;
    const windowSavingsPositive = windowSavings > 0;

    savingsWindows[key] = {
      label: config.label,
      estCost: `$${formatNumber(dailyAvg)}`,
      estMonthlyCost: `$${Math.round(monthlyProjected).toLocaleString()}`,
      estSavings: windowSavingsPositive ? `$${formatNumber(windowSavings)}/mo` : null,
      savingsPercent: windowSavingsPositive
        ? Math.round((windowSavings / monthlyProjected) * 100)
        : 0,
      requests: bucket.requests,
    };
  }

  return {
    total: formatTokens(total),
    input: formatTokens(totalInput),
    output: formatTokens(totalOutput),
    cacheRead: formatTokens(usage?.cacheRead || 0),
    cacheWrite: formatTokens(usage?.cacheWrite || 0),
    requests: usage?.requests || 0,
    activeCount,
    activeMainCount,
    activeSubagentCount,
    mainLimit,
    subagentLimit,
    estCost: `$${formatNumber(estCost)}`,
    planCost: `$${planCost.toFixed(0)}`,
    planName,
    // 24h savings (backward compatible)
    estSavings: savingsPositive ? `$${formatNumber(monthlySavings)}/mo` : null,
    savingsPercent: savingsPositive ? Math.round((monthlySavings / monthlyApiCost) * 100) : 0,
    estMonthlyCost: `$${Math.round(monthlyApiCost).toLocaleString()}`,
    // Multi-window savings (24h, 3da, 7da)
    savingsWindows,
    // Per-session averages
    avgTokensPerSession: formatTokens(avgTokensPerSession),
    avgCostPerSession: `$${avgCostPerSession.toFixed(2)}`,
    sessionCount,
  };
}

// Format number with commas and 2 decimal places
function formatNumber(n) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return n.toString();
}

// API endpoint
function handleApi(req, res) {
  const sessions = getSessions();
  const tokenStats = getTokenStats(sessions);
  const capacity = getCapacity();

  const data = {
    sessions,
    cron: getCronJobs(),
    system: getSystemStatus(),
    activity: getRecentActivity(),
    tokenStats,
    capacity,
    timestamp: new Date().toISOString(),
  };

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

// Read session transcript from JSONL file
function readTranscript(sessionId) {
  const openclawDir = getOpenClawDir();
  const transcriptPath = path.join(openclawDir, "agents", "main", "sessions", `${sessionId}.jsonl`);

  try {
    if (!fs.existsSync(transcriptPath)) return [];
    const content = fs.readFileSync(transcriptPath, "utf8");
    return content
      .trim()
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (e) {
    console.error("Failed to read transcript:", e.message);
    return [];
  }
}

// Get detailed session info
function getSessionDetail(sessionKey) {
  try {
    // Get basic session info
    const listOutput = runOpenClaw("sessions list --json 2>/dev/null");
    let sessionInfo = null;
    const jsonStr = extractJSON(listOutput);
    if (jsonStr) {
      const data = JSON.parse(jsonStr);
      sessionInfo = data.sessions?.find((s) => s.key === sessionKey);
    }

    if (!sessionInfo) {
      return { error: "Session not found" };
    }

    // Read transcript directly from JSONL file
    const transcript = readTranscript(sessionInfo.sessionId);
    let messages = [];
    let tools = {};
    let facts = [];
    let needsAttention = [];

    // Aggregate token usage from transcript
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let totalCost = 0;
    let detectedModel = sessionInfo.model || null;

    // Process transcript entries (format: {type: "message", message: {role, content, usage}})
    transcript.forEach((entry) => {
      if (entry.type !== "message" || !entry.message) return;

      const msg = entry.message;
      if (!msg.role) return;

      // Extract token usage from messages (typically on assistant messages)
      if (msg.usage) {
        totalInputTokens += msg.usage.input || msg.usage.inputTokens || 0;
        totalOutputTokens += msg.usage.output || msg.usage.outputTokens || 0;
        totalCacheRead += msg.usage.cacheRead || msg.usage.cacheReadTokens || 0;
        totalCacheWrite += msg.usage.cacheWrite || msg.usage.cacheWriteTokens || 0;
        if (msg.usage.cost?.total) totalCost += msg.usage.cost.total;
      }

      // Detect model from assistant messages
      if (msg.role === "assistant" && msg.model && !detectedModel) {
        detectedModel = msg.model;
      }

      let text = "";
      if (typeof msg.content === "string") {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        const textPart = msg.content.find((c) => c.type === "text");
        if (textPart) text = textPart.text || "";

        // Count tool calls
        msg.content
          .filter((c) => c.type === "toolCall" || c.type === "tool_use")
          .forEach((tc) => {
            const name = tc.name || tc.tool || "unknown";
            tools[name] = (tools[name] || 0) + 1;
          });
      }

      if (text && msg.role !== "toolResult") {
        messages.push({ role: msg.role, text, timestamp: entry.timestamp });
      }

      // Extract insights from user messages
      if (msg.role === "user" && text) {
        const lowerText = text.toLowerCase();

        // Look for questions
        if (text.includes("?")) {
          const questions = text.match(/[^.!?\n]*\?/g) || [];
          questions.slice(0, 2).forEach((q) => {
            if (q.length > 15 && q.length < 200) {
              needsAttention.push(`❓ ${q.trim()}`);
            }
          });
        }

        // Look for action items
        if (
          lowerText.includes("todo") ||
          lowerText.includes("remind") ||
          lowerText.includes("need to")
        ) {
          const match = text.match(/(?:todo|remind|need to)[^.!?\n]*/i);
          if (match) needsAttention.push(`📋 ${match[0].slice(0, 100)}`);
        }
      }

      // Extract facts from assistant messages
      if (msg.role === "assistant" && text) {
        const lowerText = text.toLowerCase();

        // Look for completions
        ["✅", "done", "created", "updated", "fixed", "deployed"].forEach((keyword) => {
          if (lowerText.includes(keyword)) {
            const lines = text.split("\n").filter((l) => l.toLowerCase().includes(keyword));
            lines.slice(0, 2).forEach((line) => {
              if (line.length > 5 && line.length < 150) {
                facts.push(line.trim().slice(0, 100));
              }
            });
          }
        });
      }
    });

    // Generate summary from recent messages
    let summary = "No activity yet.";
    const userMessages = messages.filter((m) => m.role === "user");
    const assistantMessages = messages.filter((m) => m.role === "assistant");
    let topics = [];

    if (messages.length > 0) {
      summary = `${messages.length} messages (${userMessages.length} user, ${assistantMessages.length} assistant). `;

      // Identify main topics from all text using pattern matching
      const allText = messages.map((m) => m.text).join(" ");
      topics = detectTopics(allText);

      if (topics.length > 0) {
        summary += `Topics: ${topics.join(", ")}.`;
      }
    }

    // Convert tools to array
    const toolsArray = Object.entries(tools)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Calculate last active time
    const ageMs = sessionInfo.ageMs || 0;
    const lastActive =
      ageMs < 60000
        ? "Just now"
        : ageMs < 3600000
          ? `${Math.round(ageMs / 60000)} minutes ago`
          : ageMs < 86400000
            ? `${Math.round(ageMs / 3600000)} hours ago`
            : `${Math.round(ageMs / 86400000)} days ago`;

    // Determine readable channel name
    // Priority: groupChannel > displayName > parsed from key > fallback
    let channelDisplay = "Other";
    if (sessionInfo.groupChannel) {
      channelDisplay = sessionInfo.groupChannel;
    } else if (sessionInfo.displayName) {
      channelDisplay = sessionInfo.displayName;
    } else if (sessionKey.includes("slack")) {
      // Try to parse channel name from key
      const parts = sessionKey.split(":");
      const channelIdx = parts.indexOf("channel");
      if (channelIdx >= 0 && parts[channelIdx + 1]) {
        const channelId = parts[channelIdx + 1].toLowerCase();
        channelDisplay = CHANNEL_MAP[channelId] || `#${channelId}`;
      } else {
        channelDisplay = "Slack";
      }
    } else if (sessionKey.includes("telegram")) {
      channelDisplay = "Telegram";
    }

    // Use parsed totals or fallback to session info
    const finalTotalTokens = totalInputTokens + totalOutputTokens || sessionInfo.totalTokens || 0;
    const finalInputTokens = totalInputTokens || sessionInfo.inputTokens || 0;
    const finalOutputTokens = totalOutputTokens || sessionInfo.outputTokens || 0;

    // Format model name (strip prefix)
    const modelDisplay = (detectedModel || sessionInfo.model || "-")
      .replace("anthropic/", "")
      .replace("openai/", "");

    return {
      key: sessionKey,
      kind: sessionInfo.kind,
      channel: channelDisplay,
      groupChannel: sessionInfo.groupChannel || channelDisplay,
      model: modelDisplay,
      tokens: finalTotalTokens,
      inputTokens: finalInputTokens,
      outputTokens: finalOutputTokens,
      cacheRead: totalCacheRead,
      cacheWrite: totalCacheWrite,
      estCost: totalCost > 0 ? `$${totalCost.toFixed(4)}` : null,
      lastActive,
      summary,
      topics, // Array of detected topics
      facts: [...new Set(facts)].slice(0, 8),
      needsAttention: [...new Set(needsAttention)].slice(0, 5),
      tools: toolsArray.slice(0, 10),
      messages: messages
        .slice(-15)
        .reverse()
        .map((m) => ({
          role: m.role,
          text: m.text.slice(0, 500),
        })),
    };
  } catch (e) {
    console.error("Failed to get session detail:", e.message);
    return { error: e.message };
  }
}

// Cerebro topic data
const CEREBRO_DIR = PATHS.cerebro;

function getCerebroTopics(options = {}) {
  const { offset = 0, limit = 20, status: filterStatus = "all" } = options;
  const topicsDir = path.join(CEREBRO_DIR, "topics");
  const orphansDir = path.join(CEREBRO_DIR, "orphans");
  const topics = [];

  // Result in format expected by frontend renderCerebro()
  const result = {
    initialized: false,
    cerebroPath: CEREBRO_DIR,
    topics: { active: 0, resolved: 0, parked: 0, total: 0 },
    threads: 0,
    orphans: 0,
    recentTopics: [],
    lastUpdated: null,
  };

  try {
    // Check if cerebro directory exists
    if (!fs.existsSync(CEREBRO_DIR)) {
      return result;
    }

    result.initialized = true;
    let latestModified = null;

    if (!fs.existsSync(topicsDir)) {
      return result;
    }

    const topicNames = fs.readdirSync(topicsDir).filter((name) => {
      const topicPath = path.join(topicsDir, name);
      return fs.statSync(topicPath).isDirectory() && !name.startsWith("_");
    });

    // Parse each topic
    topicNames.forEach((name) => {
      const topicMdPath = path.join(topicsDir, name, "topic.md");
      const topicDirPath = path.join(topicsDir, name);

      // Get stat from topic.md or directory
      let stat;
      let content = "";
      if (fs.existsSync(topicMdPath)) {
        stat = fs.statSync(topicMdPath);
        content = fs.readFileSync(topicMdPath, "utf8");
      } else {
        stat = fs.statSync(topicDirPath);
      }

      try {
        // Parse YAML frontmatter
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        let title = name;
        let topicStatus = "active";
        let category = "general";
        let created = null;

        if (frontmatterMatch) {
          const frontmatter = frontmatterMatch[1];
          const titleMatch = frontmatter.match(/title:\s*(.+)/);
          const statusMatch = frontmatter.match(/status:\s*(.+)/);
          const categoryMatch = frontmatter.match(/category:\s*(.+)/);
          const createdMatch = frontmatter.match(/created:\s*(.+)/);

          if (titleMatch) title = titleMatch[1].trim();
          if (statusMatch) topicStatus = statusMatch[1].trim().toLowerCase();
          if (categoryMatch) category = categoryMatch[1].trim();
          if (createdMatch) created = createdMatch[1].trim();
        }

        // Count threads
        const threadsDir = path.join(topicsDir, name, "threads");
        let threadCount = 0;
        if (fs.existsSync(threadsDir)) {
          threadCount = fs
            .readdirSync(threadsDir)
            .filter((f) => f.endsWith(".md") || f.endsWith(".json")).length;
        }

        // Accumulate total threads
        result.threads += threadCount;

        // Count by status
        if (topicStatus === "active") result.topics.active++;
        else if (topicStatus === "resolved") result.topics.resolved++;
        else if (topicStatus === "parked") result.topics.parked++;

        // Track latest modification
        if (!latestModified || stat.mtime > latestModified) {
          latestModified = stat.mtime;
        }

        topics.push({
          name,
          title,
          status: topicStatus,
          category,
          created,
          threads: threadCount,
          lastModified: stat.mtimeMs,
        });
      } catch (e) {
        console.error(`Failed to parse topic ${name}:`, e.message);
      }
    });

    result.topics.total = topics.length;

    // Sort: active first, then by most recently modified
    const statusPriority = { active: 0, resolved: 1, parked: 2 };
    topics.sort((a, b) => {
      const statusDiff = (statusPriority[a.status] || 3) - (statusPriority[b.status] || 3);
      if (statusDiff !== 0) return statusDiff;
      return b.lastModified - a.lastModified;
    });

    // Filter by status for recentTopics display
    let filtered = topics;
    if (filterStatus !== "all") {
      filtered = topics.filter((t) => t.status === filterStatus);
    }

    // Format for recentTopics (paginated)
    const paginated = filtered.slice(offset, offset + limit);
    result.recentTopics = paginated.map((t) => ({
      name: t.name,
      title: t.title,
      status: t.status,
      threads: t.threads,
      age: formatTimeAgo(new Date(t.lastModified)),
    }));

    // Count orphans
    if (fs.existsSync(orphansDir)) {
      try {
        result.orphans = fs.readdirSync(orphansDir).filter((f) => f.endsWith(".md")).length;
      } catch (e) {}
    }

    result.lastUpdated = latestModified ? latestModified.toISOString() : null;
  } catch (e) {
    console.error("Failed to get Cerebro topics:", e.message);
  }

  return result;
}

// Update topic status in topic.md file
function updateTopicStatus(topicId, newStatus) {
  const topicDir = path.join(CEREBRO_DIR, "topics", topicId);
  const topicFile = path.join(topicDir, "topic.md");

  // Check if topic exists
  if (!fs.existsSync(topicDir)) {
    return { error: `Topic '${topicId}' not found`, code: 404 };
  }

  // If topic.md doesn't exist, create it with basic frontmatter
  if (!fs.existsSync(topicFile)) {
    const content = `---
title: ${topicId}
status: ${newStatus}
category: general
created: ${new Date().toISOString().split("T")[0]}
---

# ${topicId}

## Overview
*Topic tracking file.*

## Notes
`;
    fs.writeFileSync(topicFile, content, "utf8");
    return {
      topic: {
        id: topicId,
        name: topicId,
        title: topicId,
        status: newStatus,
      },
    };
  }

  // Read existing topic.md
  let content = fs.readFileSync(topicFile, "utf8");
  let title = topicId;

  // Check if it has YAML frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

  if (frontmatterMatch) {
    // Has frontmatter - update status field
    let frontmatter = frontmatterMatch[1];

    // Extract title if present
    const titleMatch = frontmatter.match(/title:\s*["']?([^"'\n]+)["']?/i);
    if (titleMatch) title = titleMatch[1];

    if (frontmatter.includes("status:")) {
      // Replace existing status
      frontmatter = frontmatter.replace(
        /status:\s*(active|resolved|parked)/i,
        `status: ${newStatus}`,
      );
    } else {
      // Add status field
      frontmatter = frontmatter.trim() + `\nstatus: ${newStatus}`;
    }

    content = content.replace(/^---\n[\s\S]*?\n---/, `---\n${frontmatter}\n---`);
  } else {
    // No frontmatter - add one
    const headerMatch = content.match(/^#\s*(.+)/m);
    if (headerMatch) title = headerMatch[1];

    const frontmatter = `---
title: ${title}
status: ${newStatus}
category: general
created: ${new Date().toISOString().split("T")[0]}
---

`;
    content = frontmatter + content;
  }

  // Write updated content
  fs.writeFileSync(topicFile, content, "utf8");

  return {
    topic: {
      id: topicId,
      name: topicId,
      title: title,
      status: newStatus,
    },
  };
}

// Serve static files
function serveStatic(req, res) {
  let filePath = req.url === "/" ? "/index.html" : req.url;
  filePath = path.join(DASHBOARD_DIR, filePath);

  const ext = path.extname(filePath);
  const contentTypes = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentTypes[ext] || "text/plain" });
    res.end(content);
  });
}

// Cache for LLM usage data (openclaw CLI is slow ~4-5s)
let llmUsageCache = { data: null, timestamp: 0, refreshing: false };
const LLM_CACHE_TTL_MS = 60000; // 60 seconds

// Background async refresh of LLM usage data
function refreshLlmUsageAsync() {
  if (llmUsageCache.refreshing) return; // Already refreshing
  llmUsageCache.refreshing = true;

  const profile = process.env.OPENCLAW_PROFILE || "";
  const profileFlag = profile ? ` --profile ${profile}` : "";
  exec(
    `openclaw${profileFlag} status --usage --json`,
    { encoding: "utf8", timeout: 20000 },
    (err, stdout) => {
      llmUsageCache.refreshing = false;
      if (err) {
        console.error("[LLM Usage] Async refresh failed:", err.message);
        return;
      }
      try {
        // Extract JSON portion - openclaw may output doctor warnings before JSON
        const jsonStart = stdout.indexOf("{");
        const jsonStr = jsonStart >= 0 ? stdout.slice(jsonStart) : stdout;
        const parsed = JSON.parse(jsonStr);
        if (parsed.usage) {
          const result = transformLiveUsageData(parsed.usage);
          llmUsageCache.data = result;
          llmUsageCache.timestamp = Date.now();
          console.log("[LLM Usage] Cache refreshed");
        }
      } catch (e) {
        console.error("[LLM Usage] Parse error:", e.message);
      }
    },
  );
}

// Transform live usage data from OpenClaw CLI
function transformLiveUsageData(usage) {
  const anthropic = usage.providers?.find((p) => p.provider === "anthropic");
  const codexProvider = usage.providers?.find((p) => p.provider === "openai-codex");

  // Check for auth errors
  if (anthropic?.error) {
    return {
      timestamp: new Date().toISOString(),
      source: "error",
      error: anthropic.error,
      errorType: anthropic.error.includes("403") ? "auth" : "unknown",
      claude: {
        session: { usedPct: null, remainingPct: null, resetsIn: null, error: anthropic.error },
        weekly: { usedPct: null, remainingPct: null, resets: null, error: anthropic.error },
        sonnet: { usedPct: null, remainingPct: null, resets: null, error: anthropic.error },
        lastSynced: null,
      },
      codex: { sessionsToday: 0, tasksToday: 0, usage5hPct: 0, usageDayPct: 0 },
      routing: {
        total: 0,
        claudeTasks: 0,
        codexTasks: 0,
        claudePct: 0,
        codexPct: 0,
        codexFloor: 20,
      },
    };
  }

  const session5h = anthropic?.windows?.find((w) => w.label === "5h");
  const weekAll = anthropic?.windows?.find((w) => w.label === "Week");
  const sonnetWeek = anthropic?.windows?.find((w) => w.label === "Sonnet");
  const codex5h = codexProvider?.windows?.find((w) => w.label === "5h");
  const codexDay = codexProvider?.windows?.find((w) => w.label === "Day");

  const formatReset = (resetAt) => {
    if (!resetAt) return "?";
    const diff = resetAt - Date.now();
    if (diff < 0) return "now";
    if (diff < 3600000) return Math.round(diff / 60000) + "m";
    if (diff < 86400000) return Math.round(diff / 3600000) + "h";
    return Math.round(diff / 86400000) + "d";
  };

  return {
    timestamp: new Date().toISOString(),
    source: "live",
    claude: {
      session: {
        usedPct: Math.round(session5h?.usedPercent || 0),
        remainingPct: Math.round(100 - (session5h?.usedPercent || 0)),
        resetsIn: formatReset(session5h?.resetAt),
      },
      weekly: {
        usedPct: Math.round(weekAll?.usedPercent || 0),
        remainingPct: Math.round(100 - (weekAll?.usedPercent || 0)),
        resets: formatReset(weekAll?.resetAt),
      },
      sonnet: {
        usedPct: Math.round(sonnetWeek?.usedPercent || 0),
        remainingPct: Math.round(100 - (sonnetWeek?.usedPercent || 0)),
        resets: formatReset(sonnetWeek?.resetAt),
      },
      lastSynced: new Date().toISOString(),
    },
    codex: {
      sessionsToday: 0,
      tasksToday: 0,
      usage5hPct: Math.round(codex5h?.usedPercent || 0),
      usageDayPct: Math.round(codexDay?.usedPercent || 0),
    },
    routing: { total: 0, claudeTasks: 0, codexTasks: 0, claudePct: 0, codexPct: 0, codexFloor: 20 },
  };
}

// Start background refresh on startup
setTimeout(() => refreshLlmUsageAsync(), 1000);
setInterval(() => refreshLlmUsageAsync(), LLM_CACHE_TTL_MS);

// Get LLM usage stats - returns cached data immediately, refreshes in background
function getLlmUsage() {
  const now = Date.now();

  // If cache is stale or empty, trigger background refresh
  if (!llmUsageCache.data || now - llmUsageCache.timestamp > LLM_CACHE_TTL_MS) {
    refreshLlmUsageAsync();
  }

  // Return cached data if available AND not an error
  // If cache has error, try file fallback first
  if (llmUsageCache.data && llmUsageCache.data.source !== "error") {
    return llmUsageCache.data;
  }

  // Cache empty or has error - check if we can read from state file
  // But don't return misleading 0% values - return error/loading state instead
  const stateFile = path.join(PATHS.state, "llm-routing.json");
  try {
    if (fs.existsSync(stateFile)) {
      const data = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      // Only use file data if it has valid (non-placeholder) usage values
      // Check for "unknown" resets which indicates placeholder data from failed sync
      const sessionValid =
        data.claude?.session?.resets_in && data.claude.session.resets_in !== "unknown";
      const weeklyValid =
        data.claude?.weekly_all_models?.resets &&
        data.claude.weekly_all_models.resets !== "unknown";
      if (sessionValid || weeklyValid) {
        return {
          timestamp: new Date().toISOString(),
          source: "file",
          claude: {
            session: {
              usedPct: Math.round((data.claude?.session?.used_pct || 0) * 100),
              remainingPct: Math.round((data.claude?.session?.remaining_pct || 1) * 100),
              resetsIn: data.claude?.session?.resets_in || "?",
            },
            weekly: {
              usedPct: Math.round((data.claude?.weekly_all_models?.used_pct || 0) * 100),
              remainingPct: Math.round((data.claude?.weekly_all_models?.remaining_pct || 1) * 100),
              resets: data.claude?.weekly_all_models?.resets || "?",
            },
            sonnet: {
              usedPct: Math.round((data.claude?.weekly_sonnet?.used_pct || 0) * 100),
              remainingPct: Math.round((data.claude?.weekly_sonnet?.remaining_pct || 1) * 100),
              resets: data.claude?.weekly_sonnet?.resets || "?",
            },
            lastSynced: data.claude?.last_synced || null,
          },
          codex: {
            sessionsToday: data.codex?.sessions_today || 0,
            tasksToday: data.codex?.tasks_today || 0,
            usage5hPct: data.codex?.usage_5h_pct || 0,
            usageDayPct: data.codex?.usage_day_pct || 0,
          },
          routing: {
            total: data.routing?.total_tasks || 0,
            claudeTasks: data.routing?.claude_tasks || 0,
            codexTasks: data.routing?.codex_tasks || 0,
            claudePct:
              data.routing?.total_tasks > 0
                ? Math.round((data.routing.claude_tasks / data.routing.total_tasks) * 100)
                : 0,
            codexPct:
              data.routing?.total_tasks > 0
                ? Math.round((data.routing.codex_tasks / data.routing.total_tasks) * 100)
                : 0,
            codexFloor: Math.round((data.routing?.codex_floor_pct || 0.2) * 100),
          },
        };
      }
    }
  } catch (e) {
    console.error("[LLM Usage] File fallback failed:", e.message);
  }

  // No valid data - return auth error state (we know API returns 403)
  return {
    timestamp: new Date().toISOString(),
    source: "error",
    error: "API key lacks user:profile OAuth scope",
    errorType: "auth",
    claude: {
      session: { usedPct: null, remainingPct: null, resetsIn: null, error: "Auth required" },
      weekly: { usedPct: null, remainingPct: null, resets: null, error: "Auth required" },
      sonnet: { usedPct: null, remainingPct: null, resets: null, error: "Auth required" },
      lastSynced: null,
    },
    codex: { sessionsToday: 0, tasksToday: 0, usage5hPct: 0, usageDayPct: 0 },
    routing: { total: 0, claudeTasks: 0, codexTasks: 0, claudePct: 0, codexPct: 0, codexFloor: 20 },
  };
}
function getRoutingStats(hours = 24) {
  try {
    const skillDir = path.join(PATHS.skills, "llm_routing");
    const output = execSync(
      `cd "${skillDir}" && python -m llm_routing stats --hours ${hours} --json 2>/dev/null`,
      {
        encoding: "utf8",
        timeout: 10000,
      },
    );
    return JSON.parse(output);
  } catch (e) {
    // Fallback: read JSONL directly
    try {
      const logFile = path.join(PATHS.state, "routing-log.jsonl");
      if (!fs.existsSync(logFile)) {
        return { total_requests: 0, by_model: {}, by_task_type: {} };
      }

      const cutoff = Date.now() - hours * 3600 * 1000;
      const lines = fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean);

      const stats = {
        total_requests: 0,
        by_model: {},
        by_task_type: {},
        escalations: 0,
        avg_latency_ms: 0,
        success_rate: 0,
      };

      let latencies = [];
      let successes = 0;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const ts = new Date(entry.timestamp).getTime();
          if (ts < cutoff) continue;

          stats.total_requests++;

          // By model
          const model = entry.selected_model || "unknown";
          stats.by_model[model] = (stats.by_model[model] || 0) + 1;

          // By task type
          const tt = entry.task_type || "unknown";
          stats.by_task_type[tt] = (stats.by_task_type[tt] || 0) + 1;

          if (entry.escalation_reason) stats.escalations++;
          if (entry.latency_ms) latencies.push(entry.latency_ms);
          if (entry.success === true) successes++;
        } catch {}
      }

      if (latencies.length > 0) {
        stats.avg_latency_ms = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
      }
      if (stats.total_requests > 0) {
        stats.success_rate = Math.round((successes / stats.total_requests) * 100);
      }

      return stats;
    } catch (e2) {
      console.error("Failed to read routing stats:", e2.message);
      return { error: e2.message };
    }
  }
}

// Get detailed sub-agent status
function getSubagentStatus() {
  const subagents = [];
  try {
    const output = runOpenClaw("sessions list --json 2>/dev/null");
    const jsonStr = extractJSON(output);
    if (jsonStr) {
      const data = JSON.parse(jsonStr);
      const subagentSessions = (data.sessions || []).filter(
        (s) => s.key && s.key.includes(":subagent:"),
      );

      for (const s of subagentSessions) {
        const ageMs = s.ageMs || Infinity;
        const isActive = ageMs < 5 * 60 * 1000; // Active if < 5 min
        const isRecent = ageMs < 30 * 60 * 1000; // Recent if < 30 min

        // Extract subagent ID from key
        const match = s.key.match(/:subagent:([a-f0-9-]+)$/);
        const subagentId = match ? match[1] : s.sessionId;
        const shortId = subagentId.slice(0, 8);

        // Try to get task info from transcript
        let taskSummary = "Unknown task";
        let label = null;
        const transcript = readTranscript(s.sessionId);

        // Look for task description in first 15 messages (subagent context can be deep)
        for (const entry of transcript.slice(0, 15)) {
          if (entry.type === "message" && entry.message?.role === "user") {
            const content = entry.message.content;
            let text = "";
            if (typeof content === "string") {
              text = content;
            } else if (Array.isArray(content)) {
              const textPart = content.find((c) => c.type === "text");
              if (textPart) text = textPart.text || "";
            }

            if (!text) continue;

            // Extract label from subagent context
            const labelMatch = text.match(/Label:\s*([^\n]+)/i);
            if (labelMatch) {
              label = labelMatch[1].trim();
            }

            // Extract task summary - try multiple patterns
            // Pattern 1: "You were created to handle: **TASK**"
            let taskMatch = text.match(/You were created to handle:\s*\*\*([^*]+)\*\*/i);
            if (taskMatch) {
              taskSummary = taskMatch[1].trim();
              break;
            }

            // Pattern 2: Linear issue format "**JON-XXX: Description**"
            taskMatch = text.match(/\*\*([A-Z]{2,5}-\d+:\s*[^*]+)\*\*/);
            if (taskMatch) {
              taskSummary = taskMatch[1].trim();
              break;
            }

            // Pattern 3: First meaningful line of user message
            const firstLine = text
              .split("\n")[0]
              .replace(/^\*\*|\*\*$/g, "")
              .trim();
            if (firstLine.length > 10 && firstLine.length < 100) {
              taskSummary = firstLine;
              break;
            }
          }
        }

        // Count messages
        const messageCount = transcript.filter(
          (e) => e.type === "message" && e.message?.role,
        ).length;

        subagents.push({
          id: subagentId,
          shortId,
          sessionId: s.sessionId,
          label: label || shortId,
          task: taskSummary,
          model: s.model?.replace("anthropic/", "") || "unknown",
          status: isActive ? "active" : isRecent ? "idle" : "stale",
          ageMs,
          ageFormatted:
            ageMs < 60000
              ? "Just now"
              : ageMs < 3600000
                ? `${Math.round(ageMs / 60000)}m ago`
                : `${Math.round(ageMs / 3600000)}h ago`,
          messageCount,
          tokens: s.totalTokens || 0,
        });
      }
    }
  } catch (e) {
    console.error("Failed to get subagent status:", e.message);
  }

  // Sort by age (most recent first)
  return subagents.sort((a, b) => a.ageMs - b.ageMs);
}

// Execute quick actions
function executeAction(action) {
  const results = { success: false, action, output: "", error: null };

  try {
    switch (action) {
      case "gateway-status":
        results.output = runOpenClaw("gateway status 2>&1") || "Unknown";
        results.success = true;
        break;

      case "gateway-restart":
        // Don't actually restart - return instructions
        results.output = "To restart gateway, run: openclaw gateway restart";
        results.success = true;
        results.note = "Dashboard cannot restart gateway for safety";
        break;

      case "sessions-list":
        results.output = runOpenClaw("sessions list 2>&1") || "No sessions";
        results.success = true;
        break;

      case "cron-list":
        results.output = runOpenClaw("cron list 2>&1") || "No cron jobs";
        results.success = true;
        break;

      case "health-check":
        const gateway = runOpenClaw("gateway status 2>&1");
        const sessions = runOpenClaw("sessions list --json 2>&1");
        let sessionCount = 0;
        try {
          const data = JSON.parse(sessions);
          sessionCount = data.sessions?.length || 0;
        } catch (e) {}

        results.output = [
          `Gateway: ${gateway?.includes("running") ? "✅ Running" : "❌ Not running"}`,
          `Sessions: ${sessionCount}`,
          `Dashboard: ✅ Running on port ${PORT}`,
        ].join("\n");
        results.success = true;
        break;

      case "clear-stale-sessions":
        // List stale sessions (> 24h old)
        const staleOutput = runOpenClaw("sessions list --json 2>&1");
        let staleCount = 0;
        try {
          const staleJson = extractJSON(staleOutput);
          if (staleJson) {
            const data = JSON.parse(staleJson);
            staleCount = (data.sessions || []).filter((s) => s.ageMs > 24 * 60 * 60 * 1000).length;
          }
        } catch (e) {}
        results.output = `Found ${staleCount} stale sessions (>24h old).\nTo clean: openclaw sessions prune`;
        results.success = true;
        break;

      default:
        results.error = `Unknown action: ${action}`;
    }
  } catch (e) {
    results.error = e.message;
  }

  return results;
}

// Create server
const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");

  const urlParts = req.url.split("?");
  const pathname = urlParts[0];
  const query = new URLSearchParams(urlParts[1] || "");

  // Fast path for health check - bypasses all processing
  if (pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", port: PORT, timestamp: new Date().toISOString() }));
    return;
  }

  // Auth check (unless public path)
  const isPublicPath = AUTH_CONFIG.publicPaths.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  if (!isPublicPath && AUTH_CONFIG.mode !== "none") {
    const authResult = checkAuth(req);

    if (!authResult.authorized) {
      console.log(`[AUTH] Denied: ${authResult.reason} (path: ${pathname})`);
      res.writeHead(403, { "Content-Type": "text/html" });
      res.end(getUnauthorizedPage(authResult.reason, authResult.user));
      return;
    }

    // Attach user info to request for downstream use
    req.authUser = authResult.user;

    // Log successful auth (debug)
    if (authResult.user?.login || authResult.user?.email) {
      console.log(
        `[AUTH] Allowed: ${authResult.user.login || authResult.user.email} (path: ${pathname})`,
      );
    } else {
      console.log(`[AUTH] Allowed: ${req.socket?.remoteAddress} (path: ${pathname})`);
    }
  }

  if (pathname === "/api/status") {
    handleApi(req, res);
  } else if (pathname === "/api/session") {
    const sessionKey = query.get("key");
    if (!sessionKey) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing session key" }));
      return;
    }
    const detail = getSessionDetail(sessionKey);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(detail, null, 2));
  } else if (pathname === "/api/cerebro") {
    const offset = parseInt(query.get("offset") || "0", 10);
    const limit = parseInt(query.get("limit") || "20", 10);
    const status = query.get("status") || "all";

    const data = getCerebroTopics({ offset, limit, status });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data, null, 2));
  } else if (
    pathname.startsWith("/api/cerebro/topic/") &&
    pathname.endsWith("/status") &&
    req.method === "POST"
  ) {
    // POST /api/cerebro/topic/:topicId/status - Update topic status
    const topicId = decodeURIComponent(
      pathname.replace("/api/cerebro/topic/", "").replace("/status", ""),
    );

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const { status: newStatus } = JSON.parse(body);

        if (!newStatus || !["active", "resolved", "parked"].includes(newStatus)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "Invalid status. Must be: active, resolved, or parked" }),
          );
          return;
        }

        const result = updateTopicStatus(topicId, newStatus);

        if (result.error) {
          res.writeHead(result.code || 500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: result.error }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result, null, 2));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
      }
    });
    return; // Don't fall through since we're handling async
  } else if (pathname === "/api/llm-quota") {
    // Legacy endpoint - redirects to llm-usage
    const data = getLlmUsage();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data, null, 2));
  } else if (pathname === "/api/cost-breakdown") {
    const data = getCostBreakdown();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data, null, 2));
  } else if (pathname === "/api/subagents") {
    const data = getSubagentStatus();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ subagents: data }, null, 2));
  } else if (pathname === "/api/action") {
    const action = query.get("action");
    if (!action) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing action parameter" }));
      return;
    }
    const result = executeAction(action);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result, null, 2));
  } else if (pathname === "/api/events") {
    // SSE endpoint for real-time updates
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    sseClients.add(res);
    console.log(`[SSE] Client connected (total: ${sseClients.size})`);

    // Send initial connection message
    sendSSE(res, "connected", { message: "Connected to Command Center", timestamp: Date.now() });

    // Send cached state immediately (non-blocking)
    // If no cache, send empty state - next refresh will populate
    if (cachedState) {
      sendSSE(res, "update", cachedState);
    } else {
      sendSSE(res, "update", { sessions: [], loading: true });
    }

    // Handle disconnect
    req.on("close", () => {
      sseClients.delete(res);
      console.log(`[SSE] Client disconnected (total: ${sseClients.size})`);
    });

    return; // Keep connection open
  } else if (pathname === "/api/whoami") {
    // Return current user info
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        {
          authMode: AUTH_CONFIG.mode,
          user: req.authUser || null,
        },
        null,
        2,
      ),
    );
  } else if (pathname === "/api/about") {
    // Dashboard info
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        {
          name: "OpenClaw Command Center",
          version: "0.1.0",
          description: "A Starcraft-inspired dashboard for AI agent orchestration",
          license: "MIT",
          repository: "https://github.com/jontsai/openclaw-command-center",
          builtWith: ["OpenClaw", "Node.js", "Vanilla JS"],
          inspirations: ["Starcraft", "Inside Out", "iStatMenus", "DaisyDisk", "Gmail"],
        },
        null,
        2,
      ),
    );
  } else if (pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", port: PORT, timestamp: new Date().toISOString() }));
  } else if (pathname === "/api/state") {
    // Unified state endpoint - single source of truth for all dashboard data
    const state = getFullState();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(state, null, 2));
  } else if (pathname === "/api/vitals") {
    const vitals = getSystemVitals();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ vitals }, null, 2));
  } else if (pathname === "/api/capacity") {
    const capacity = getCapacity();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(capacity, null, 2));
  } else if (pathname === "/api/sessions") {
    const page = parseInt(query.get("page")) || 1;
    const pageSize = parseInt(query.get("pageSize")) || 20;
    const statusFilter = query.get("status"); // live, recent, idle, or null for all

    // Get ALL sessions for accurate counts
    const allSessions = getSessions({ limit: null });

    // Calculate status counts (always from all sessions)
    const statusCounts = {
      all: allSessions.length,
      live: allSessions.filter((s) => s.active).length,
      recent: allSessions.filter((s) => !s.active && s.recentlyActive).length,
      idle: allSessions.filter((s) => !s.active && !s.recentlyActive).length,
    };

    // Apply status filter
    let filteredSessions = allSessions;
    if (statusFilter === "live") {
      filteredSessions = allSessions.filter((s) => s.active);
    } else if (statusFilter === "recent") {
      filteredSessions = allSessions.filter((s) => !s.active && s.recentlyActive);
    } else if (statusFilter === "idle") {
      filteredSessions = allSessions.filter((s) => !s.active && !s.recentlyActive);
    }

    // Paginate
    const total = filteredSessions.length;
    const totalPages = Math.ceil(total / pageSize);
    const offset = (page - 1) * pageSize;
    const displaySessions = filteredSessions.slice(offset, offset + pageSize);

    const tokenStats = getTokenStats(allSessions);
    const capacity = getCapacity();

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        {
          sessions: displaySessions,
          pagination: {
            page,
            pageSize,
            total,
            totalPages,
            hasPrev: page > 1,
            hasNext: page < totalPages,
          },
          statusCounts,
          tokenStats,
          capacity,
        },
        null,
        2,
      ),
    );
  } else if (pathname === "/api/cron") {
    const cron = getCronJobs();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ cron }, null, 2));
  } else if (pathname === "/api/operators") {
    // Operators management endpoint
    const method = req.method;
    const data = loadOperators();

    if (method === "GET") {
      // Get all operators with stats
      const sessions = getSessions({ limit: null });
      const operatorsWithStats = data.operators.map((op) => {
        const userSessions = sessions.filter(
          (s) => s.originator?.userId === op.id || s.originator?.userId === op.metadata?.slackId,
        );
        return {
          ...op,
          stats: {
            activeSessions: userSessions.filter((s) => s.active).length,
            totalSessions: userSessions.length,
            lastSeen:
              userSessions.length > 0
                ? new Date(
                    Date.now() - Math.min(...userSessions.map((s) => s.minutesAgo)) * 60000,
                  ).toISOString()
                : op.lastSeen,
          },
        };
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          {
            operators: operatorsWithStats,
            roles: data.roles,
            timestamp: Date.now(),
          },
          null,
          2,
        ),
      );
    } else if (method === "POST") {
      // Add/update operator (requires auth)
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const newOp = JSON.parse(body);
          const existingIdx = data.operators.findIndex((op) => op.id === newOp.id);
          if (existingIdx >= 0) {
            data.operators[existingIdx] = { ...data.operators[existingIdx], ...newOp };
          } else {
            data.operators.push({
              ...newOp,
              createdAt: new Date().toISOString(),
            });
          }
          if (saveOperators(data)) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, operator: newOp }));
          } else {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Failed to save" }));
          }
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
      return;
    } else {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
    }
    return;
  } else if (pathname === "/api/llm-usage") {
    const usage = getLlmUsage();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(usage, null, 2));
  } else if (pathname === "/api/routing-stats") {
    const hours = parseInt(query.get("hours") || "24", 10);
    const stats = getRoutingStats(hours);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(stats, null, 2));
  } else if (pathname === "/api/memory") {
    const memory = getMemoryStats();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ memory }, null, 2));
  } else if (pathname === "/api/privacy") {
    // Privacy Settings API - GET/POST/PUT
    if (req.method === "GET") {
      const settings = loadPrivacySettings();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(settings, null, 2));
    } else if (req.method === "POST" || req.method === "PUT") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const updates = JSON.parse(body);
          const current = loadPrivacySettings();

          // Merge updates into current settings
          const merged = {
            version: current.version || 1,
            hiddenTopics: updates.hiddenTopics ?? current.hiddenTopics ?? [],
            hiddenSessions: updates.hiddenSessions ?? current.hiddenSessions ?? [],
            hiddenCrons: updates.hiddenCrons ?? current.hiddenCrons ?? [],
            hideHostname: updates.hideHostname ?? current.hideHostname ?? false,
          };

          if (savePrivacySettings(merged)) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, settings: merged }));
          } else {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Failed to save privacy settings" }));
          }
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON: " + e.message }));
        }
      });
      return;
    } else {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
    }
    return;
  } else if (isJobsRoute(pathname)) {
    // Jobs Framework API - handles /api/jobs/*
    handleJobsRequest(req, res, pathname, query, req.method);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  const profile = process.env.OPENCLAW_PROFILE;
  console.log(`🦞 OpenClaw Command Center running at http://localhost:${PORT}`);
  if (profile) {
    console.log(`   Profile: ${profile} (~/.openclaw-${profile})`);
  }
  console.log(`   Press Ctrl+C to stop`);

  // Pre-warm caches in background after server starts (non-blocking)
  setTimeout(async () => {
    console.log("[Startup] Pre-warming caches in background...");
    try {
      // Prime caches async - these don't block
      await Promise.all([refreshSessionsCache(), refreshTokenUsageAsync()]);
      getSystemVitals(); // This uses its own async cache
      console.log("[Startup] Caches warmed.");
    } catch (e) {
      console.log("[Startup] Cache warming error:", e.message);
    }
  }, 100);

  // Background cache refresh (async, non-blocking)
  setInterval(() => refreshSessionsCache(), SESSIONS_CACHE_TTL);
  setInterval(() => refreshTokenUsageAsync(), TOKEN_USAGE_CACHE_TTL);
});

// SSE heartbeat - broadcast full state periodically
let sseRefreshing = false;
setInterval(() => {
  if (sseClients.size > 0 && !sseRefreshing) {
    sseRefreshing = true;
    try {
      const state = refreshState();
      broadcastSSE("update", state);
      broadcastSSE("heartbeat", { clients: sseClients.size, timestamp: Date.now() });
    } catch (e) {
      console.error("[SSE] Broadcast error:", e.message);
    }
    sseRefreshing = false;
  }
}, 15000); // 15-second updates (reduced from 5s to avoid blocking)
