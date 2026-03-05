const fs = require("fs");
const path = require("path");
const { formatNumber, formatTokens } = require("./utils");

// Claude Opus 4 pricing (per 1M tokens)
const TOKEN_RATES = {
  input: 15.0, // $15/1M input tokens
  output: 75.0, // $75/1M output tokens
  cacheRead: 1.5, // $1.50/1M (90% discount from input)
  cacheWrite: 18.75, // $18.75/1M (25% premium on input)
};

// Token usage cache with async background refresh
let tokenUsageCache = { data: null, timestamp: 0, refreshing: false };
const TOKEN_USAGE_CACHE_TTL = 30000; // 30 seconds

// Reference to background refresh interval (set by startTokenUsageRefresh)
let refreshInterval = null;

// Create empty usage bucket
function emptyUsageBucket() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, requests: 0 };
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
function getDailyTokenUsage(getOpenClawDir) {
  const now = Date.now();
  const isStale = now - tokenUsageCache.timestamp > TOKEN_USAGE_CACHE_TTL;

  // Trigger async refresh if stale (don't await)
  if (isStale && !tokenUsageCache.refreshing && getOpenClawDir) {
    refreshTokenUsageAsync(getOpenClawDir);
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
function getCostBreakdown(config, getSessions, getOpenClawDir) {
  const usage = getDailyTokenUsage(getOpenClawDir);
  if (!usage) {
    return { error: "Failed to get usage data" };
  }

  // Calculate costs for 24h (primary display)
  const costs = calculateCostForBucket(usage);

  // Get plan info from config
  const planCost = config.billing?.claudePlanCost || 200;
  const planName = config.billing?.claudePlanName || "Claude Code Max";

  // Calculate moving averages for each window
  const windowConfigs = {
    "24h": { days: 1, label: "24h" },
    "3d": { days: 3, label: "3dma" },
    "7d": { days: 7, label: "7dma" },
  };

  const windows = {};
  for (const [key, windowConfig] of Object.entries(windowConfigs)) {
    const bucket = usage.windows?.[key] || usage;
    const bucketCosts = calculateCostForBucket(bucket);
    const dailyAvg = bucketCosts.totalCost / windowConfig.days;
    const monthlyProjected = dailyAvg * 30;
    const monthlySavings = monthlyProjected - planCost;

    windows[key] = {
      label: windowConfig.label,
      days: windowConfig.days,
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
    topSessions: getTopSessionsByTokens(5, getSessions),
  };
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
function getTokenStats(sessions, capacity, config = {}) {
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
  const planCost = config?.billing?.claudePlanCost ?? 200;
  const planName = config?.billing?.claudePlanName ?? "Claude Code Max";
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
  for (const [key, windowConfig] of Object.entries(windowConfigs)) {
    // Map '3dma' -> '3d' for bucket lookup
    const bucketKey = key.replace("dma", "d").replace("24h", "24h");
    const bucket = usage.windows?.[bucketKey === "24h" ? "24h" : bucketKey] || usage;
    const bucketCosts = calculateCostForBucket(bucket);
    const dailyAvg = bucketCosts.totalCost / windowConfig.days;
    const monthlyProjected = dailyAvg * 30;
    const windowSavings = monthlyProjected - planCost;
    const windowSavingsPositive = windowSavings > 0;

    savingsWindows[key] = {
      label: windowConfig.label,
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

// Start background token usage refresh on an interval
// Call this once during server startup instead of auto-starting on module load
function startTokenUsageRefresh(getOpenClawDir) {
  // Do an initial refresh
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
  refreshTokenUsageAsync,
  getDailyTokenUsage,
  calculateCostForBucket,
  getCostBreakdown,
  getTopSessionsByTokens,
  getTokenStats,
  startTokenUsageRefresh,
};
