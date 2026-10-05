const fs = require("fs");
const path = require("path");
const { formatNumber, formatTokens } = require("./utils");
const { usageReportCache } = require("./usage-report");

// Claude Opus 4 pricing (per 1M tokens)
const TOKEN_RATES = {
  input: 15.0, // $15/1M input tokens
  output: 75.0, // $75/1M output tokens
  cacheRead: 1.5, // $1.50/1M (90% discount from input)
  cacheWrite: 18.75, // $18.75/1M (25% premium on input)
};

// Token usage cache with async background refresh
let tokenUsageCache = { data: null, timestamp: 0, refreshing: false };
const TOKEN_USAGE_CACHE_TTL = 300000; // 5 minutes
let tokenUsageFileCache = new Map();

// Reference to background refresh interval (set by startTokenUsageRefresh)
let refreshInterval = null;

// Create empty usage bucket
function emptyUsageBucket() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, requests: 0 };
}

function addUsageToBucket(bucket, usage) {
  bucket.input += usage.input;
  bucket.output += usage.output;
  bucket.cacheRead += usage.cacheRead;
  bucket.cacheWrite += usage.cacheWrite;
  bucket.cost += usage.cost;
  bucket.requests++;
  bucket.missingCostEntries =
    (bucket.missingCostEntries || 0) + (usage.costKnown === false ? 1 : 0);
}

function collectTokenUsageEvents(content, sevenDaysAgo) {
  const events = [];
  const lines = content.trim().split("\n");

  for (const line of lines) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      const entryTime = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
      if (entryTime < sevenDaysAgo || !entry.message?.usage) continue;
      const u = entry.message.usage;
      events.push({
        time: entryTime,
        input: u.input || 0,
        output: u.output || 0,
        cacheRead: u.cacheRead || 0,
        cacheWrite: u.cacheWrite || 0,
        cost: Number.isFinite(u.cost?.total) ? u.cost.total : 0,
        costKnown: Number.isFinite(u.cost?.total),
      });
    } catch (e) {
      // Skip invalid lines
    }
  }

  return events;
}

// Async token usage refresh - runs in background, doesn't block
async function refreshTokenUsageAsync(getOpenClawDir) {
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

    // Process files in batches to avoid overwhelming the system. Cache parsed usage
    // events by file mtime/size so routine refreshes do not re-parse every JSONL line.
    let unreadableFiles = 0;
    const seenFiles = new Set();
    const batchSize = 50;
    for (let i = 0; i < jsonlFiles.length; i += batchSize) {
      const batch = jsonlFiles.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (file) => {
          const filePath = path.join(sessionsDir, file);
          seenFiles.add(filePath);

          try {
            const stat = await fs.promises.stat(filePath);
            // Skip files not modified in the last 7 days
            if (stat.mtimeMs < sevenDaysAgo) {
              tokenUsageFileCache.delete(filePath);
              return;
            }

            const cached = tokenUsageFileCache.get(filePath);
            let events = cached?.events;

            if (!cached || cached.mtimeMs !== stat.mtimeMs || cached.size !== stat.size) {
              const content = await fs.promises.readFile(filePath, "utf8");
              events = collectTokenUsageEvents(content, sevenDaysAgo);
              tokenUsageFileCache.set(filePath, {
                mtimeMs: stat.mtimeMs,
                size: stat.size,
                events,
              });
            }

            for (const event of events) {
              // Re-apply moving windows on every refresh without re-parsing JSON.
              if (event.time < sevenDaysAgo) continue;
              if (event.time >= oneDayAgo) addUsageToBucket(usage24h, event);
              if (event.time >= threeDaysAgo) addUsageToBucket(usage3d, event);
              addUsageToBucket(usage7d, event);
            }
          } catch (e) {
            // A partial scan is not a measured zero.
            unreadableFiles++;
            tokenUsageFileCache.delete(filePath);
          }
        }),
      );

      // Yield to event loop between batches
      await new Promise((resolve) => setImmediate(resolve));
    }

    for (const filePath of tokenUsageFileCache.keys()) {
      if (!seenFiles.has(filePath)) tokenUsageFileCache.delete(filePath);
    }

    // Helper to finalize bucket with computed fields
    const finalizeBucket = (bucket) => ({
      ...bucket,
      tokensNoCache: bucket.input + bucket.output,
      tokensWithCache: bucket.input + bucket.output + bucket.cacheRead + bucket.cacheWrite,
    });

    const result = {
      available: jsonlFiles.length > 0 && unreadableFiles === 0,
      source: "legacy-jsonl",
      period: "24h",
      updatedAt: Date.now(),
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
function getDailyTokenUsage(getOpenClawDir) {
  const modern = usageReportCache.get();
  if (modern) return modern;
  const now = Date.now();
  const isStale = now - tokenUsageCache.timestamp > TOKEN_USAGE_CACHE_TTL;

  // Trigger async refresh if stale (don't await)
  if (isStale && !tokenUsageCache.refreshing && getOpenClawDir) {
    refreshTokenUsageAsync(getOpenClawDir);
  }

  const emptyResult = {
    available: false,
    source: "unavailable",
    period: "Usage unavailable",
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
  return tokenUsageCache.data
    ? {
        ...tokenUsageCache.data,
        available: tokenUsageCache.data.available && now - tokenUsageCache.timestamp < 900000,
        stale: now - tokenUsageCache.timestamp >= 900000,
      }
    : emptyResult;
}

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

// Recorded costs are model-aware API equivalents, not a subscription bill.
function buildCostBreakdown(usage, topSessions = []) {
  const available = usage?.available === true;
  const missing = usage?.missingCostEntries || 0;
  const costKnown = available && missing === 0 && Number.isFinite(usage.cost);
  const num = (key) => (available && Number.isFinite(usage[key]) ? usage[key] : null);
  const windows = {};
  for (const [key, days] of [
    ["24h", 1],
    ["3d", 3],
    ["7d", 7],
  ]) {
    const bucket = usage?.windows?.[key];
    const complete =
      available && bucket && !(bucket.missingCostEntries > 0) && Number.isFinite(bucket.cost);
    windows[key] = {
      label: key === "24h" ? usage?.period : `${days}-day average`,
      totalCost: complete ? bucket.cost : null,
      dailyAvg: complete ? bucket.cost / days : null,
      recordedCost: available && Number.isFinite(bucket?.cost) ? bucket.cost : null,
      missingCostEntries: available ? (bucket?.missingCostEntries ?? null) : null,
    };
  }
  return {
    status: available ? (missing ? "partial" : "available") : "unavailable",
    period: usage?.period || "Usage unavailable",
    source: usage?.source || "unavailable",
    updatedAt: usage?.updatedAt || null,
    refreshing: usage?.refreshing || false,
    stale: usage?.stale || false,
    missingCostEntries: missing,
    inputTokens: num("input"),
    outputTokens: num("output"),
    cacheRead: num("cacheRead"),
    cacheWrite: num("cacheWrite"),
    requests: num("requests"),
    totalCost: costKnown ? usage.cost : null,
    recordedCost: num("cost"),
    calculation: {
      inputCost: costKnown ? num("inputCost") : null,
      outputCost: costKnown ? num("outputCost") : null,
      cacheReadCost: costKnown ? num("cacheReadCost") : null,
      cacheWriteCost: costKnown ? num("cacheWriteCost") : null,
    },
    pricingBasis:
      "Recorded per-model API-equivalent costs from OpenClaw; not subscription charges.",
    savingsReason: "Subscription savings are not inferred from usage or account quota.",
    windows,
    topSessions,
    topSessionsScope: "Current sessions — lifetime token totals, not this reporting window.",
  };
}
function getCostBreakdown(config, getSessions, getOpenClawDir) {
  return buildCostBreakdown(
    getDailyTokenUsage(getOpenClawDir),
    getTopSessionsByTokens(5, getSessions),
  );
}

// Get top sessions sorted by token usage
function getTopSessionsByTokens(limit = 5, getSessions) {
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

  const usage = getDailyTokenUsage();
  const report = buildCostBreakdown(usage);
  const known = usage?.available === true;
  const total = known ? usage.input + usage.output : null;
  const money = (value) => (Number.isFinite(value) ? `$${formatNumber(value)}` : "N/A");
  return {
    total: known ? formatTokens(total) : "N/A",
    input: known ? formatTokens(usage.input) : "N/A",
    output: known ? formatTokens(usage.output) : "N/A",
    cacheRead: known ? formatTokens(usage.cacheRead) : "N/A",
    cacheWrite: known ? formatTokens(usage.cacheWrite) : "N/A",
    requests: known ? usage.requests : null,
    activeCount,
    activeMainCount,
    activeSubagentCount,
    mainLimit,
    subagentLimit,
    estCost: money(report.totalCost),
    recordedCost: Number.isFinite(report.recordedCost) ? money(report.recordedCost) : null,
    missingCostEntries: report.missingCostEntries,
    costWindows: report.windows,
    costPeriod: report.period,
    costStatus: report.status,
    costRefreshing: report.refreshing,
    planCost: "N/A",
    planName: "Plan not inferred",
    estSavings: null,
    savingsPercent: 0,
    estMonthlyCost: "N/A",
    savingsWindows: Object.fromEntries(
      Object.entries(report.windows).map(([key, w]) => [
        key === "24h" ? key : key + "ma",
        {
          label: w.label,
          estCost: money(w.dailyAvg),
          estMonthlyCost: "N/A",
          estSavings: null,
          savingsPercent: 0,
        },
      ]),
    ),
    avgTokensPerSession: "N/A",
    avgCostPerSession: "N/A",
    sessionCount: sessions?.length || 0,
  };
}

// Start background token usage refresh on an interval
// Call this once during server startup instead of auto-starting on module load
function startTokenUsageRefresh(getOpenClawDir) {
  // Do an initial refresh
  void usageReportCache.refresh();
  refreshTokenUsageAsync(getOpenClawDir);

  // Set up periodic refresh
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
  refreshInterval = setInterval(() => {
    refreshTokenUsageAsync(getOpenClawDir);
  }, TOKEN_USAGE_CACHE_TTL);

  return refreshInterval;
}

module.exports = {
  TOKEN_RATES,
  emptyUsageBucket,
  collectTokenUsageEvents,
  refreshTokenUsageAsync,
  getDailyTokenUsage,
  calculateCostForBucket,
  getCostBreakdown,
  buildCostBreakdown,
  getTopSessionsByTokens,
  getTokenStats,
  startTokenUsageRefresh,
};
