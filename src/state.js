const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { formatBytes, formatTimeAgo } = require("./utils");

/**
 * Creates a state management module with injected dependencies.
 *
 * @param {object} deps
 * @param {object} deps.CONFIG - config object (for paths, billing)
 * @param {function} deps.getOpenClawDir - returns the OpenClaw directory path
 * @param {function} deps.getSessions - function from sessions module
 * @param {function} deps.getSystemVitals - function from vitals module
 * @param {function} deps.getCronJobs - function from cron module
 * @param {function} deps.loadOperators - function from operators module
 * @param {function} deps.getLlmUsage - function from llm-usage module
 * @param {function} deps.getDailyTokenUsage - function from tokens module
 * @param {function} deps.getTokenStats - function from tokens module
 * @param {function} deps.getCerebroTopics - function from cerebro module
 * @param {function} deps.getMemoryStats - function (defined in this module, uses CONFIG.paths)
 * @param {function} deps.runOpenClaw - function from openclaw module
 * @param {function} deps.extractJSON - function from openclaw module
 * @param {function} deps.readTranscript - function from sessions module
 */
function createStateModule(deps) {
  const {
    CONFIG,
    getOpenClawDir,
    getSessions,
    getSystemVitals,
    getCronJobs,
    loadOperators,
    getLlmUsage,
    getDailyTokenUsage,
    getTokenStats,
    getCerebroTopics,
    runOpenClaw,
    extractJSON,
    readTranscript,
  } = deps;

  const PATHS = CONFIG.paths;

  // Module-level state
  let cachedState = null;
  let lastStateUpdate = 0;
  const STATE_CACHE_TTL = 30000; // 30 seconds - reduce blocking from CLI calls
  let stateRefreshInterval = null;

  // Get system status
  function getSystemStatus() {
    const hostname = execSync("hostname", { encoding: "utf8" }).trim();
    let uptime = "\u2014";
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
            icon: text.includes("\u2705")
              ? "\u2705"
              : text.includes("\u274C")
                ? "\u274C"
                : "\uD83D\uDCDD",
            text: text.replace(/[\u2705\u274C\uD83D\uDCDD\uD83D\uDD27]/g, "").trim(),
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

    // Try to get active counts from sessions (preferred - has full session keys)
    try {
      const output = runOpenClaw("sessions --json 2>/dev/null");
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
      console.error("Failed to get capacity from sessions, falling back to filesystem:", e.message);
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
          } else if (
            entry.isFile() &&
            (entry.name.endsWith(".md") || entry.name.endsWith(".json"))
          ) {
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

  // Get all data for dashboard (legacy endpoint)
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

  // Unified state for dashboard (single source of truth)
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
      tokenStats = getTokenStats(allSessions, capacity, CONFIG);
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
    // Configurable retention: SUBAGENT_RETENTION_HOURS env var (default 12h)
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
  function startStateRefresh(broadcastSSE, intervalMs = 30000) {
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

  // Stop background refresh
  function stopStateRefresh() {
    if (stateRefreshInterval) {
      clearInterval(stateRefreshInterval);
      stateRefreshInterval = null;
      console.log("[State] Background refresh stopped");
    }
  }

  // Get detailed sub-agent status
  function getSubagentStatus() {
    const subagents = [];
    try {
      const output = runOpenClaw("sessions --json 2>/dev/null");
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

  return {
    getSystemStatus,
    getRecentActivity,
    getCapacity,
    getMemoryStats,
    getFullState,
    refreshState,
    startStateRefresh,
    stopStateRefresh,
    getData,
    getSubagentStatus,
  };
}

module.exports = { createStateModule };
