const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { getSafeEnv } = require("./openclaw");

// Cache for LLM usage data (openclaw CLI is slow ~4-5s)
let llmUsageCache = { data: null, timestamp: 0, refreshing: false };
const LLM_CACHE_TTL_MS = 60000; // 60 seconds

// Background async refresh of LLM usage data
function refreshLlmUsageAsync() {
  if (llmUsageCache.refreshing) return; // Already refreshing
  llmUsageCache.refreshing = true;

  const profile = process.env.OPENCLAW_PROFILE || "";
  const args = profile
    ? ["--profile", profile, "status", "--usage", "--json"]
    : ["status", "--usage", "--json"];
  execFile(
    "openclaw",
    args,
    { encoding: "utf8", timeout: 20000, env: getSafeEnv() },
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

// Get LLM usage stats - returns cached data immediately, refreshes in background
function getLlmUsage(statePath) {
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
  const stateFile = path.join(statePath, "llm-routing.json");
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

function getRoutingStats(skillsPath, statePath, hours = 24) {
  const safeHours = parseInt(hours, 10) || 24;
  try {
    const { execFileSync } = require("child_process");
    const skillDir = path.join(skillsPath, "llm_routing");
    const output = execFileSync(
      "python",
      ["-m", "llm_routing", "stats", "--hours", String(safeHours), "--json"],
      {
        encoding: "utf8",
        timeout: 10000,
        cwd: skillDir,
        env: getSafeEnv(),
      },
    );
    return JSON.parse(output);
  } catch (e) {
    // Fallback: read JSONL directly
    try {
      const logFile = path.join(statePath, "routing-log.jsonl");
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

// Start background refresh timers (call explicitly, not on require)
function startLlmUsageRefresh() {
  setTimeout(() => refreshLlmUsageAsync(), 1000);
  setInterval(() => refreshLlmUsageAsync(), LLM_CACHE_TTL_MS);
}

module.exports = {
  refreshLlmUsageAsync,
  transformLiveUsageData,
  getLlmUsage,
  getRoutingStats,
  startLlmUsageRefresh,
};
