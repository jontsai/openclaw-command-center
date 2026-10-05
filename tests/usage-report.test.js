const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeUsageReport, createUsageReportCache } = require("../src/usage-report");
const { buildCostBreakdown } = require("../src/tokens");
const now = Date.UTC(2026, 0, 7, 12);
const row = (date, cost = 3) => ({
  date,
  input: 100,
  output: 20,
  cacheRead: 30,
  cacheWrite: 0,
  totalCost: cost,
  inputCost: 1,
  outputCost: 2,
  cacheReadCost: 0,
  cacheWriteCost: 0,
  missingCostEntries: 0,
});
const report = () => ({
  updatedAt: now,
  days: 7,
  daily: [row("2026-01-01", 1), row("2026-01-06", 2), row("2026-01-07", 3)],
  cacheStatus: { status: "refreshing", pendingFiles: 2 },
});
test("calendar windows use recorded costs, not Opus rates or lifetime session tokens", () => {
  const usage = normalizeUsageReport(report(), now);
  assert.equal(usage.period, "Today (UTC)");
  assert.equal(usage.cost, 3);
  assert.equal(usage.windows["3d"].cost, 5);
  assert.equal(usage.windows["7d"].cost, 6);
  const cost = buildCostBreakdown(usage, [{ tokens: 99999999, label: "Example" }]);
  assert.equal(cost.totalCost, 3);
  assert.equal(cost.inputTokens, 100);
  assert.equal(cost.calculation.outputCost, 2);
  assert.equal(cost.refreshing, true);
  assert.match(cost.pricingBasis, /not subscription charges/);
  assert.equal(cost.planCost, undefined);
  assert.equal(cost.rates, undefined);
});
test("zero, unknown and partially priced usage remain distinct", () => {
  const empty = normalizeUsageReport({ updatedAt: now, days: 7, daily: [] }, now);
  assert.equal(buildCostBreakdown(empty).totalCost, 0);
  assert.equal(buildCostBreakdown({ available: false }).totalCost, null);
  const raw = report();
  raw.daily[2].missingCostEntries = 1;
  const partial = buildCostBreakdown(normalizeUsageReport(raw, now));
  assert.equal(partial.status, "partial");
  assert.equal(partial.totalCost, null);
  assert.equal(partial.recordedCost, 3);
  assert.equal(partial.inputTokens, 100);
  raw.daily[2].totalCost = 0;
  const unpriced = buildCostBreakdown(normalizeUsageReport(raw, now));
  assert.equal(unpriced.recordedCost, 0);
  assert.equal(unpriced.totalCost, null);
  assert.equal(unpriced.missingCostEntries, 1);
});
test("invalid buckets fail closed", () => {
  const raw = report();
  raw.daily[0].input = -1;
  assert.throws(() => normalizeUsageReport(raw, now));
  const dupe = report();
  dupe.daily.push(dupe.daily[0]);
  assert.throws(() => normalizeUsageReport(dupe, now));
});
test("usage refresh is single-flight, throttled, and expires across UTC midnight", async () => {
  let time = now,
    calls = 0,
    release;
  const cache = createUsageReportCache({
    now: () => time,
    run: () => {
      calls++;
      return new Promise((r) => {
        release = r;
      });
    },
  });
  const first = cache.refresh();
  const second = cache.refresh();
  assert.equal(first, second);
  assert.equal(calls, 1);
  release(JSON.stringify(report()));
  await first;
  assert.equal(cache.get().cost, 3);
  assert.equal(calls, 1);
  time = Date.UTC(2026, 0, 8);
  assert.equal(cache.get().available, false);
  assert.equal(cache.get().stale, true);
  assert.equal(calls, 2);
  release("bad");
  await cache.refresh();
  assert.equal(cache.get().available, false);
});
