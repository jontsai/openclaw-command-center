// Gateway-owned accounting supports modern transcript stores without reading their schema.
const { runOpenClawAsync, extractJSON } = require("./openclaw");
const TTL = 300000;
const MAX_AGE = 900000;
const DAY = 86400000;
function normalizeUsageReport(report, now = Date.now()) {
  if (
    !report ||
    !Array.isArray(report.daily) ||
    !Number.isFinite(report.updatedAt) ||
    report.updatedAt > now + 60000
  )
    throw new Error("Invalid usage report");
  const today = new Date(now).toISOString().slice(0, 10);
  const fields = ["input", "output", "cacheRead", "cacheWrite", "totalCost", "missingCostEntries"];
  const dates = new Set();
  for (const row of report.daily) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
      dates.has(row.date) ||
      fields.some((k) => !Number.isFinite(row[k]) || row[k] < 0)
    )
      throw new Error("Invalid usage bucket");
    dates.add(row.date);
  }
  const bucket = (days) => {
    const start = new Date(now - (days - 1) * DAY).toISOString().slice(0, 10);
    const rows = report.daily.filter((r) => r.date >= start && r.date <= today);
    const sum = (k) => rows.reduce((n, r) => n + (Number.isFinite(r[k]) ? r[k] : 0), 0);
    const missing = sum("missingCostEntries");
    return {
      input: sum("input"),
      output: sum("output"),
      cacheRead: sum("cacheRead"),
      cacheWrite: sum("cacheWrite"),
      cost: sum("totalCost"),
      missingCostEntries: missing,
      costComplete: missing === 0,
      requests: null,
      inputCost: rows.every((r) => Number.isFinite(r.inputCost)) ? sum("inputCost") : null,
      outputCost: rows.every((r) => Number.isFinite(r.outputCost)) ? sum("outputCost") : null,
      cacheReadCost: rows.every((r) => Number.isFinite(r.cacheReadCost))
        ? sum("cacheReadCost")
        : null,
      cacheWriteCost: rows.every((r) => Number.isFinite(r.cacheWriteCost))
        ? sum("cacheWriteCost")
        : null,
      tokensNoCache: sum("input") + sum("output"),
      tokensWithCache: sum("input") + sum("output") + sum("cacheRead") + sum("cacheWrite"),
    };
  };
  const windows = { "24h": bucket(1), "3d": bucket(3), "7d": bucket(7) };
  return {
    ...windows["24h"],
    windows,
    available: true,
    source: "gateway",
    period: "Today (UTC)",
    periodKey: today,
    updatedAt: report.updatedAt,
    refreshing: report.cacheStatus?.status === "refreshing",
    pendingFiles: report.cacheStatus?.pendingFiles || 0,
  };
}
function createUsageReportCache({ run = runOpenClawAsync, now = Date.now } = {}) {
  let snapshot = null,
    pending = null,
    attemptedAt = null,
    error = null;
  function refresh() {
    if (pending) return pending;
    if (attemptedAt !== null && now() - attemptedAt < TTL) return Promise.resolve(snapshot);
    attemptedAt = now();
    pending = (async () => {
      try {
        const output = await run([
          "gateway",
          "call",
          "usage.cost",
          "--params",
          JSON.stringify({ days: 7, agentId: "main", mode: "utc" }),
          "--json",
        ]);
        snapshot = normalizeUsageReport(JSON.parse(extractJSON(output)), now());
        error = null;
      } catch {
        error = "Usage report unavailable";
      } finally {
        pending = null;
      }
      return snapshot;
    })();
    return pending;
  }
  function get() {
    void refresh();
    if (!snapshot) return null;
    const stale =
      now() - snapshot.updatedAt > MAX_AGE ||
      snapshot.periodKey !== new Date(now()).toISOString().slice(0, 10);
    return { ...snapshot, available: !stale, stale, error };
  }
  return { refresh, get };
}
const usageReportCache = createUsageReportCache();
module.exports = { normalizeUsageReport, createUsageReportCache, usageReportCache };
