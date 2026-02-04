#!/usr/bin/env node
/**
 * OpenClaw Command Center Dashboard Server
 * Serves the dashboard UI and provides API endpoints for status data
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync, exec } = require("child_process");
const { handleJobsRequest, isJobsRoute } = require("./jobs");
const { CONFIG } = require("./config");

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
const DATA_DIR = path.join(DASHBOARD_DIR, "data");

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

// Extract session originator from transcript
function getSessionOriginator(sessionId) {
  try {
    if (!sessionId) return null;

    const transcriptPath = path.join(
      process.env.HOME,
      ".openclaw",
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

// Get detailed system vitals (iStatMenus-style)
function getSystemVitals() {
  const vitals = {
    hostname: "",
    uptime: "",
    disk: { used: 0, free: 0, total: 0, percent: 0 },
    cpu: { loadAvg: [0, 0, 0], cores: 0, usage: 0 },
    memory: { used: 0, free: 0, total: 0, percent: 0, pressure: "normal" },
    temperature: null,
  };

  try {
    // Hostname
    vitals.hostname = execSync("hostname", { encoding: "utf8" }).trim();

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

  return vitals;
}

// Helper to run openclaw commands
function runOpenClaw(args) {
  const profile = process.env.OPENCLAW_PROFILE || "";
  const profileFlag = profile ? ` --profile ${profile}` : "";
  try {
    const result = execSync(`openclaw${profileFlag} ${args}`, {
      encoding: "utf8",
      timeout: 10000,
      env: { ...process.env, NO_COLOR: "1" },
    });
    return result;
  } catch (e) {
    console.error(`openclaw${profileFlag} ${args} failed:`, e.message);
    return null;
  }
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
    const transcriptPath = path.join(
      process.env.HOME,
      ".openclaw",
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
  try {
    const output = runOpenClaw("sessions list --json 2>/dev/null");
    if (output) {
      const data = JSON.parse(output);
      let sessions = data.sessions || [];
      if (limit != null) {
        sessions = sessions.slice(0, limit);
      }
      return sessions.map((s) => {
        // Calculate active status from ageMs
        const minutesAgo = s.ageMs ? s.ageMs / 60000 : Infinity;

        // Determine channel type from key
        let channel = "other";
        if (s.key.includes("slack")) channel = "slack";
        else if (s.key.includes("telegram")) channel = "telegram";

        const originator = getSessionOriginator(s.sessionId);

        // Use groupChannel if available, otherwise parse from key
        const label = s.groupChannel || s.displayName || parseSessionLabel(s.key);

        // Get topic for session (lightweight detection)
        const topic = getSessionTopic(s.sessionId);

        return {
          sessionKey: s.key,
          sessionId: s.sessionId,
          label: label,
          groupChannel: s.groupChannel || null,
          displayName: s.displayName || null,
          kind: s.kind,
          channel: channel,
          active: minutesAgo < 15,
          recentlyActive: minutesAgo < 60,
          minutesAgo: Math.round(minutesAgo),
          tokens: s.totalTokens || 0,
          model: s.model,
          originator: originator,
          topic: topic,
        };
      });
    }
  } catch (e) {
    console.error("Failed to get sessions:", e.message);
  }
  return [];
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
    const cronPath = path.join(process.env.HOME, ".openclaw", "cron", "jobs.json");
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
  const memoryFile = path.join(process.env.HOME, "clawd", "memory", `${today}.md`);

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

  // Read max capacity from openclaw config
  try {
    const configPath = path.join(process.env.HOME, ".openclaw", "openclaw.json");
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

  // Query active sessions via openclaw CLI
  try {
    // Use openclaw sessions list which actually works (gateway /api/sessions doesn't exist)
    const profile = process.env.OPENCLAW_PROFILE || "";
    const profileFlag = profile ? ` --profile ${profile}` : "";
    const response = execSync(`openclaw${profileFlag} sessions list --json 2>/dev/null`, {
      timeout: 5000,
      encoding: "utf8",
    });
    const data = JSON.parse(response);

    if (data?.sessions) {
      // Count active sessions (updated in last 5 minutes = likely active)
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      let mainActive = 0;
      let subActive = 0;

      for (const session of data.sessions) {
        // Check if session is active (updated in last 5 minutes)
        const isActive = session.updatedAt > fiveMinAgo;
        if (!isActive) continue;

        // Subagents have ':subagent:' in their key (e.g., 'agent:main:subagent:UUID')
        if (session.key?.includes(":subagent:")) {
          subActive++;
        } else if (session.key?.startsWith("agent:main:")) {
          // Main sessions start with 'agent:main:' but don't have ':subagent:'
          mainActive++;
        }
      }

      result.main.active = mainActive;
      result.subagent.active = subActive;
    }
  } catch (e) {
    console.error("Failed to get active session counts:", e.message);
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
  const sessions = getSessions();
  const tokenStats = getTokenStats(sessions);
  const capacity = getCapacity();
  const memory = getMemoryStats();

  // Calculate status counts based on session activity state
  const statusCounts = {
    all: sessions.length,
    live: sessions.filter((s) => s.active).length,
    recent: sessions.filter((s) => !s.active && s.recentlyActive).length,
    idle: sessions.filter((s) => !s.active && !s.recentlyActive).length,
  };

  return {
    sessions: sessions,
    tokenStats: tokenStats,
    capacity: capacity,
    memory: memory,
    pagination: { page: 1, pageSize: 50, totalPages: 1 },
    statusCounts: statusCounts,
  };
}

// Get daily token usage from JSONL session files (accurate aggregation)
function getDailyTokenUsage() {
  try {
    const sessionsDir = path.join(process.env.HOME, ".openclaw/agents/main/sessions");
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));

    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let totalCost = 0;
    let requestCount = 0;

    for (const file of files) {
      const filePath = path.join(sessionsDir, file);
      const stat = fs.statSync(filePath);

      // Only process files modified in the last 24 hours
      if (stat.mtimeMs < oneDayAgo) continue;

      try {
        const content = fs.readFileSync(filePath, "utf8");
        const lines = content.trim().split("\n");

        for (const line of lines) {
          if (!line) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.message?.usage) {
              const u = entry.message.usage;
              totalInput += u.input || 0;
              totalOutput += u.output || 0;
              totalCacheRead += u.cacheRead || 0;
              totalCacheWrite += u.cacheWrite || 0;
              totalCost += u.cost?.total || 0;
              requestCount++;
            }
          } catch (e) {
            // Skip invalid lines
          }
        }
      } catch (e) {
        // Skip unreadable files
      }
    }

    return {
      input: totalInput,
      output: totalOutput,
      cacheRead: totalCacheRead,
      cacheWrite: totalCacheWrite,
      cost: totalCost,
      requests: requestCount,
      tokensNoCache: totalInput + totalOutput,
      tokensWithCache: totalInput + totalOutput + totalCacheRead + totalCacheWrite,
    };
  } catch (e) {
    console.error("Failed to aggregate daily usage:", e.message);
    return null;
  }
}

// Calculate aggregate token stats
function getTokenStats(sessions) {
  let activeCount = 0;
  let activeMainCount = 0;
  let activeSubagentCount = 0;

  // Get limits from config
  let mainLimit = 12;
  let subagentLimit = 24;
  try {
    const configOutput = execSync("cat ~/.openclaw/clawdbot.json 2>/dev/null", {
      encoding: "utf8",
    });
    const config = JSON.parse(configOutput);
    mainLimit = config.agents?.defaults?.maxConcurrent || 12;
    subagentLimit = config.agents?.defaults?.subagents?.maxConcurrent || 24;
  } catch (e) {
    // Use defaults
  }

  // Get active session counts from openclaw
  try {
    const output = runOpenClaw("sessions list --json 2>/dev/null");
    if (output) {
      const data = JSON.parse(output);
      (data.sessions || []).forEach((s) => {
        // Only count ACTIVE sessions (< 15 min old) for concurrency display
        const isActive = s.ageMs && s.ageMs < 15 * 60 * 1000;
        if (isActive) {
          activeCount++;
          if (s.key && s.key.includes(":subagent:")) {
            activeSubagentCount++;
          } else {
            activeMainCount++;
          }
        }
      });
    }
  } catch (e) {
    sessions.forEach((s) => {
      if (s.active) activeCount++;
    });
  }

  // Get accurate daily usage from JSONL files
  const daily = getDailyTokenUsage();
  const totalInput = daily?.input || 0;
  const totalOutput = daily?.output || 0;
  const total = totalInput + totalOutput;
  const estCost = daily?.cost || 0;

  return {
    total: formatTokens(total),
    input: formatTokens(totalInput),
    output: formatTokens(totalOutput),
    cacheRead: formatTokens(daily?.cacheRead || 0),
    cacheWrite: formatTokens(daily?.cacheWrite || 0),
    requests: daily?.requests || 0,
    activeCount,
    activeMainCount,
    activeSubagentCount,
    mainLimit,
    subagentLimit,
    estCost: `$${estCost.toFixed(2)}`,
  };
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
  const transcriptPath = path.join(
    process.env.HOME,
    ".openclaw",
    "agents",
    "main",
    "sessions",
    `${sessionId}.jsonl`,
  );

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
    if (listOutput) {
      const data = JSON.parse(listOutput);
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

// Get LLM usage stats from state file
// Transforms raw state data into format expected by renderLlmUsage() frontend
function getLlmUsage() {
  const stateFile = path.join(PATHS.state, "llm-routing.json");
  try {
    if (!fs.existsSync(stateFile)) {
      return { error: "No usage data yet", needsSync: true };
    }
    const data = JSON.parse(fs.readFileSync(stateFile, "utf8"));

    // Transform for dashboard display - match renderLlmUsage() expectations
    return {
      timestamp: new Date().toISOString(),
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
  } catch (e) {
    console.error("Failed to read LLM usage:", e.message);
    return { error: e.message };
  }
}

// Get routing stats from the llm_routing skill's JSONL log
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
    if (output) {
      const data = JSON.parse(output);
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
        const output = runOpenClaw("sessions list --json 2>&1");
        let staleCount = 0;
        try {
          const data = JSON.parse(output);
          staleCount = (data.sessions || []).filter((s) => s.ageMs > 24 * 60 * 60 * 1000).length;
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

    // Send initial data
    try {
      const data = getData();
      const memory = getMemoryStats();
      const cron = getCronJobs();
      const cerebro = getCerebroTopics();
      sendSSE(res, "update", { ...data, memory, cron, cerebro });
    } catch (e) {
      console.error("[SSE] Initial data error:", e.message);
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
  } else if (pathname === "/api/vitals") {
    const vitals = getSystemVitals();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ vitals }, null, 2));
  } else if (pathname === "/api/capacity") {
    const capacity = getCapacity();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(capacity, null, 2));
  } else if (pathname === "/api/sessions") {
    const data = getData();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        {
          sessions: data.sessions,
          pagination: data.pagination,
          statusCounts: data.statusCounts,
          tokenStats: data.tokenStats,
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
  } else if (isJobsRoute(pathname)) {
    // Jobs Framework API - handles /api/jobs/*
    handleJobsRequest(req, res, pathname, query, req.method);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`🦞 OpenClaw Command Center running at http://localhost:${PORT}`);
  console.log(`   Press Ctrl+C to stop`);
});

// SSE heartbeat - broadcast updates every 30 seconds
setInterval(() => {
  if (sseClients.size > 0) {
    try {
      const data = getData();
      const memory = getMemoryStats();
      const cron = getCronJobs();
      broadcastSSE("update", { ...data, memory, cron });
      broadcastSSE("heartbeat", { clients: sseClients.size, timestamp: Date.now() });
    } catch (e) {
      console.error("[SSE] Broadcast error:", e.message);
    }
  }
}, 30000);
