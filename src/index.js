/**
 * OpenClaw Command Center Dashboard Server
 * Serves the dashboard UI and provides API endpoints for status data
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

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

// ============================================================================
// MODULE IMPORTS (after env vars are set)
// ============================================================================
const { CONFIG, getOpenClawDir } = require("./config");
const { handleJobsRequest, isJobsRoute } = require("./jobs");
const { runOpenClaw, runOpenClawAsync, extractJSON } = require("./openclaw");
const { getSystemVitals } = require("./vitals");
const { checkAuth, getUnauthorizedPage } = require("./auth");
const { loadPrivacySettings, savePrivacySettings } = require("./privacy");
const {
  loadOperators,
  saveOperators,
  getOperatorBySlackId,
  startOperatorsRefresh,
} = require("./operators");
const { createSessionsModule } = require("./sessions");
const { getCronJobs } = require("./cron");
const { getCerebroTopics, updateTopicStatus } = require("./cerebro");
const {
  getDailyTokenUsage,
  getTokenStats,
  getCostBreakdown,
  startTokenUsageRefresh,
  refreshTokenUsageAsync,
} = require("./tokens");
const { getLlmUsage, getRoutingStats, startLlmUsageRefresh } = require("./llm-usage");
const { executeAction } = require("./actions");
const { migrateDataDir } = require("./data");
const { createStateModule } = require("./state");

// ============================================================================
// CONFIGURATION
// ============================================================================
const PORT = CONFIG.server.port;
const DASHBOARD_DIR = path.join(__dirname, "../public");
const PATHS = CONFIG.paths;

const AUTH_CONFIG = {
  mode: CONFIG.auth.mode,
  token: CONFIG.auth.token,
  allowedUsers: CONFIG.auth.allowedUsers,
  allowedIPs: CONFIG.auth.allowedIPs,
  publicPaths: CONFIG.auth.publicPaths,
};

// Profile-aware data directory
const DATA_DIR = path.join(getOpenClawDir(), "command-center", "data");
const LEGACY_DATA_DIR = path.join(DASHBOARD_DIR, "data");

// ============================================================================
// SSE (Server-Sent Events)
// ============================================================================
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

// ============================================================================
// INITIALIZE MODULES (wire up dependencies)
// ============================================================================

// Sessions module (factory pattern with dependency injection)
const sessions = createSessionsModule({
  getOpenClawDir,
  getOperatorBySlackId: (slackId) => getOperatorBySlackId(DATA_DIR, slackId),
  runOpenClaw,
  runOpenClawAsync,
  extractJSON,
});

// State module (factory pattern)
const state = createStateModule({
  CONFIG,
  getOpenClawDir,
  getSessions: (opts) => sessions.getSessions(opts),
  getSystemVitals,
  getCronJobs: () => getCronJobs(getOpenClawDir),
  loadOperators: () => loadOperators(DATA_DIR),
  getLlmUsage: () => getLlmUsage(PATHS.state),
  getDailyTokenUsage: () => getDailyTokenUsage(getOpenClawDir),
  getTokenStats,
  getCerebroTopics: (opts) => getCerebroTopics(PATHS.cerebro, opts),
  runOpenClaw,
  extractJSON,
  readTranscript: (sessionId) => sessions.readTranscript(sessionId),
});

// ============================================================================
// STARTUP: Data migration + background tasks
// ============================================================================
process.nextTick(() => migrateDataDir(DATA_DIR, LEGACY_DATA_DIR));
startOperatorsRefresh(DATA_DIR, getOpenClawDir);
startLlmUsageRefresh();
startTokenUsageRefresh(getOpenClawDir);

// ============================================================================
// STATIC FILE SERVER
// ============================================================================
function serveStatic(req, res) {
  // Parse URL to safely extract pathname (ignoring query/hash)
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;

  // Reject any path containing ".." segments (path traversal)
  if (pathname.includes("..")) {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }

  // Normalize and resolve to ensure path stays within DASHBOARD_DIR
  const normalizedPath = path.normalize(pathname).replace(/^[/\\]+/, "");
  const filePath = path.join(DASHBOARD_DIR, normalizedPath);

  const resolvedDashboardDir = path.resolve(DASHBOARD_DIR);
  const resolvedFilePath = path.resolve(filePath);
  if (
    !resolvedFilePath.startsWith(resolvedDashboardDir + path.sep) &&
    resolvedFilePath !== resolvedDashboardDir
  ) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

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
    const headers = { "Content-Type": contentTypes[ext] || "text/plain" };

    // Avoid stale dashboards (users frequently hard-refresh while iterating)
    if ([".html", ".css", ".js", ".json"].includes(ext)) {
      headers["Cache-Control"] = "no-store";
    }

    res.writeHead(200, headers);
    res.end(content);
  });
}

// ============================================================================
// LEGACY API HANDLER
// ============================================================================
function handleApi(req, res) {
  const sessionsList = sessions.getSessions();
  const capacity = state.getCapacity();
  const tokenStats = getTokenStats(sessionsList, capacity, CONFIG);

  const data = {
    sessions: sessionsList,
    cron: getCronJobs(getOpenClawDir),
    system: state.getSystemStatus(),
    activity: state.getRecentActivity(),
    tokenStats,
    capacity,
    timestamp: new Date().toISOString(),
  };

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

// ============================================================================
// HTTP SERVER
// ============================================================================
const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");

  const urlParts = req.url.split("?");
  const pathname = urlParts[0];
  const query = new URLSearchParams(urlParts[1] || "");

  // Fast path for health check
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
    const authResult = checkAuth(req, AUTH_CONFIG);

    if (!authResult.authorized) {
      console.log(`[AUTH] Denied: ${authResult.reason} (path: ${pathname})`);
      res.writeHead(403, { "Content-Type": "text/html" });
      res.end(getUnauthorizedPage(authResult.reason, authResult.user, AUTH_CONFIG));
      return;
    }

    req.authUser = authResult.user;

    if (authResult.user?.login || authResult.user?.email) {
      console.log(
        `[AUTH] Allowed: ${authResult.user.login || authResult.user.email} (path: ${pathname})`,
      );
    } else {
      console.log(`[AUTH] Allowed: ${req.socket?.remoteAddress} (path: ${pathname})`);
    }
  }

  // ---- API Routes ----

  if (pathname === "/api/status") {
    handleApi(req, res);
  } else if (pathname === "/api/session") {
    const sessionKey = query.get("key");
    if (!sessionKey) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing session key" }));
      return;
    }
    const detail = sessions.getSessionDetail(sessionKey);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(detail, null, 2));
  } else if (pathname === "/api/cerebro") {
    const offset = parseInt(query.get("offset") || "0", 10);
    const limit = parseInt(query.get("limit") || "20", 10);
    const statusFilter = query.get("status") || "all";

    const data = getCerebroTopics(PATHS.cerebro, { offset, limit, status: statusFilter });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data, null, 2));
  } else if (
    pathname.startsWith("/api/cerebro/topic/") &&
    pathname.endsWith("/status") &&
    req.method === "POST"
  ) {
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

        const result = updateTopicStatus(PATHS.cerebro, topicId, newStatus);

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
    return;
  } else if (pathname === "/api/llm-quota") {
    const data = getLlmUsage(PATHS.state);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data, null, 2));
  } else if (pathname === "/api/cost-breakdown") {
    const data = getCostBreakdown(CONFIG, (opts) => sessions.getSessions(opts), getOpenClawDir);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data, null, 2));
  } else if (pathname === "/api/subagents") {
    const data = state.getSubagentStatus();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ subagents: data }, null, 2));
  } else if (pathname === "/api/action") {
    const action = query.get("action");
    if (!action) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing action parameter" }));
      return;
    }
    const result = executeAction(action, { runOpenClaw, extractJSON, PORT });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result, null, 2));
  } else if (pathname === "/api/events") {
    // SSE endpoint
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    sseClients.add(res);
    console.log(`[SSE] Client connected (total: ${sseClients.size})`);

    sendSSE(res, "connected", { message: "Connected to Command Center", timestamp: Date.now() });

    const cachedState = state.getFullState();
    if (cachedState) {
      sendSSE(res, "update", cachedState);
    } else {
      sendSSE(res, "update", { sessions: [], loading: true });
    }

    req.on("close", () => {
      sseClients.delete(res);
      console.log(`[SSE] Client disconnected (total: ${sseClients.size})`);
    });

    return;
  } else if (pathname === "/api/whoami") {
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
  } else if (pathname === "/api/state") {
    const fullState = state.getFullState();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(fullState, null, 2));
  } else if (pathname === "/api/vitals") {
    const vitals = getSystemVitals();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ vitals }, null, 2));
  } else if (pathname === "/api/capacity") {
    const capacity = state.getCapacity();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(capacity, null, 2));
  } else if (pathname === "/api/sessions") {
    const page = parseInt(query.get("page")) || 1;
    const pageSize = parseInt(query.get("pageSize")) || 20;
    const statusFilter = query.get("status");

    const allSessions = sessions.getSessions({ limit: null });

    const statusCounts = {
      all: allSessions.length,
      live: allSessions.filter((s) => s.active).length,
      recent: allSessions.filter((s) => !s.active && s.recentlyActive).length,
      idle: allSessions.filter((s) => !s.active && !s.recentlyActive).length,
    };

    let filteredSessions = allSessions;
    if (statusFilter === "live") {
      filteredSessions = allSessions.filter((s) => s.active);
    } else if (statusFilter === "recent") {
      filteredSessions = allSessions.filter((s) => !s.active && s.recentlyActive);
    } else if (statusFilter === "idle") {
      filteredSessions = allSessions.filter((s) => !s.active && !s.recentlyActive);
    }

    const total = filteredSessions.length;
    const totalPages = Math.ceil(total / pageSize);
    const offset = (page - 1) * pageSize;
    const displaySessions = filteredSessions.slice(offset, offset + pageSize);

    const tokenStats = getTokenStats(allSessions, state.getCapacity(), CONFIG);
    const capacity = state.getCapacity();

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
    const cron = getCronJobs(getOpenClawDir);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ cron }, null, 2));
  } else if (pathname === "/api/operators") {
    const method = req.method;
    const data = loadOperators(DATA_DIR);

    if (method === "GET") {
      const allSessions = sessions.getSessions({ limit: null });
      const operatorsWithStats = data.operators.map((op) => {
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
          if (saveOperators(DATA_DIR, data)) {
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
    const usage = getLlmUsage(PATHS.state);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(usage, null, 2));
  } else if (pathname === "/api/routing-stats") {
    const hours = parseInt(query.get("hours") || "24", 10);
    const stats = getRoutingStats(PATHS.skills, PATHS.state, hours);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(stats, null, 2));
  } else if (pathname === "/api/memory") {
    const memory = state.getMemoryStats();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ memory }, null, 2));
  } else if (pathname === "/api/privacy") {
    if (req.method === "GET") {
      const settings = loadPrivacySettings(DATA_DIR);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(settings, null, 2));
    } else if (req.method === "POST" || req.method === "PUT") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const updates = JSON.parse(body);
          const current = loadPrivacySettings(DATA_DIR);

          const merged = {
            version: current.version || 1,
            hiddenTopics: updates.hiddenTopics ?? current.hiddenTopics ?? [],
            hiddenSessions: updates.hiddenSessions ?? current.hiddenSessions ?? [],
            hiddenCrons: updates.hiddenCrons ?? current.hiddenCrons ?? [],
            hideHostname: updates.hideHostname ?? current.hideHostname ?? false,
          };

          if (savePrivacySettings(DATA_DIR, merged)) {
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
    handleJobsRequest(req, res, pathname, query, req.method);
  } else {
    serveStatic(req, res);
  }
});

// ============================================================================
// START SERVER
// ============================================================================
server.listen(PORT, () => {
  const profile = process.env.OPENCLAW_PROFILE;
  console.log(`\u{1F99E} OpenClaw Command Center running at http://localhost:${PORT}`);
  if (profile) {
    console.log(`   Profile: ${profile} (~/.openclaw-${profile})`);
  }
  console.log(`   Press Ctrl+C to stop`);

  // Pre-warm caches in background
  setTimeout(async () => {
    console.log("[Startup] Pre-warming caches in background...");
    try {
      await Promise.all([sessions.refreshSessionsCache(), refreshTokenUsageAsync(getOpenClawDir)]);
      getSystemVitals();
      console.log("[Startup] Caches warmed.");
    } catch (e) {
      console.log("[Startup] Cache warming error:", e.message);
    }
  }, 100);

  // Background cache refresh
  const SESSIONS_CACHE_TTL = 10000;
  setInterval(() => sessions.refreshSessionsCache(), SESSIONS_CACHE_TTL);
});

// SSE heartbeat
let sseRefreshing = false;
setInterval(() => {
  if (sseClients.size > 0 && !sseRefreshing) {
    sseRefreshing = true;
    try {
      const fullState = state.refreshState();
      broadcastSSE("update", fullState);
      broadcastSSE("heartbeat", { clients: sseClients.size, timestamp: Date.now() });
    } catch (e) {
      console.error("[SSE] Broadcast error:", e.message);
    }
    sseRefreshing = false;
  }
}, 15000);
