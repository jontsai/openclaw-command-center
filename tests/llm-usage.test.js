const { describe, it } = require("node:test");
const assert = require("node:assert");
const { transformLiveUsageData, applyUsageFreshness } = require("../src/llm-usage");

describe("llm-usage module", () => {
  describe("transformLiveUsageData()", () => {
    it("transforms valid usage data with anthropic provider", () => {
      const usage = {
        providers: [
          {
            provider: "anthropic",
            windows: [
              { label: "5h", usedPercent: 25, resetAt: Date.now() + 3600000 },
              { label: "Week", usedPercent: 10, resetAt: Date.now() + 86400000 * 3 },
              { label: "Sonnet", usedPercent: 5, resetAt: Date.now() + 86400000 * 5 },
            ],
          },
        ],
      };

      const result = transformLiveUsageData(usage);
      assert.strictEqual(result.source, "live");
      assert.strictEqual(result.claude.session.usedPct, 25);
      assert.strictEqual(result.claude.session.remainingPct, 75);
      assert.strictEqual(result.claude.weekly.usedPct, 10);
      assert.strictEqual(result.claude.sonnet.usedPct, 5);
    });

    it("handles auth error from provider", () => {
      const usage = {
        providers: [{ provider: "anthropic", error: "403 Forbidden" }],
      };

      const result = transformLiveUsageData(usage);
      assert.strictEqual(result.source, "error");
      assert.strictEqual(result.errorType, "auth");
      assert.ok(result.error.includes("403"));
      assert.strictEqual(result.claude.session.usedPct, null);
    });

    it("handles missing windows gracefully", () => {
      const usage = { providers: [{ provider: "anthropic", windows: [] }] };
      const result = transformLiveUsageData(usage);
      assert.strictEqual(result.source, "live");
      assert.strictEqual(result.claude.session.usedPct, null);
      assert.strictEqual(result.claude.weekly.usedPct, null);
    });

    it("handles codex provider data", () => {
      const usage = {
        providers: [
          { provider: "anthropic", windows: [] },
          {
            provider: "openai-codex",
            windows: [
              { label: "5h", usedPercent: 30 },
              { label: "Day", usedPercent: 15 },
            ],
          },
        ],
      };

      const result = transformLiveUsageData(usage);
      assert.strictEqual(result.codex.usage5hPct, 30);
      assert.strictEqual(result.codex.usageDayPct, 15);
    });

    it("handles missing providers gracefully", () => {
      const usage = { providers: [] };
      const result = transformLiveUsageData(usage);
      assert.strictEqual(result.source, "live");
      assert.strictEqual(result.codex.usage5hPct, null);
    });

    it("formats reset time correctly", () => {
      const usage = {
        providers: [
          {
            provider: "anthropic",
            windows: [{ label: "5h", usedPercent: 50, resetAt: Date.now() + 30 * 60000 }],
          },
        ],
      };
      const result = transformLiveUsageData(usage);
      assert.ok(result.claude.session.resetsIn.includes("m"));
    });
  });
});

describe("independent OpenAI quota snapshots", () => {
  it("retains current OpenAI Week usage despite a Claude rate limit", () => {
    const result = transformLiveUsageData({
      providers: [
        { provider: "anthropic", error: "HTTP 429: Rate limited" },
        {
          provider: "openai",
          plan: "pro",
          accountEmail: "private@example.invalid",
          windows: [{ label: "Week", usedPercent: 28, resetAt: 1900000000000 }],
        },
      ],
    });
    assert.equal(result.codex.status, "available");
    assert.equal(result.codex.usageWeekPct, 28);
    assert.equal(result.codex.usageDayPct, null);
    assert.equal(result.codex.plan, "pro");
    assert.equal(result.codex.windows[0].resetAt, 1900000000000);
    assert.equal(result.codex.tasksToday, null);
    assert.ok(!JSON.stringify(result).includes("private@example.invalid"));
    assert.notEqual(result.errorType, "auth");
  });
  it("keeps measured zero while rejecting missing, string, negative and invalid percentages", () => {
    const values = [0, undefined, null, "20", -1, 101, NaN, Infinity];
    const result = transformLiveUsageData({
      providers: [
        {
          provider: "openai",
          windows: values.map((usedPercent, i) => ({ label: String(i), usedPercent })),
        },
      ],
    });
    assert.deepEqual(
      result.codex.windows.map((w) => w.usedPercent),
      [0, null, null, null, null, null, null, null],
    );
  });
  it("does not use error-bearing OpenAI windows or unrelated provider quotas", () => {
    const result = transformLiveUsageData({
      providers: [
        { provider: "openai", error: "401", windows: [{ label: "5h", usedPercent: 20 }] },
        { provider: "github-copilot", windows: [{ label: "Week", usedPercent: 90 }] },
      ],
    });
    assert.equal(result.codex.status, "error");
    assert.deepEqual(result.codex.windows, []);
    assert.equal(result.codex.usage5hPct, null);
    assert.equal(result.claude.session.usedPct, null);
  });
  it("masks stale quota readings but preserves the observation timestamp and labels", () => {
    const now = Date.now();
    const data = transformLiveUsageData({
      updatedAt: now - 180000,
      providers: [{ provider: "openai", windows: [{ label: "Week", usedPercent: 28 }] }],
    });
    const result = applyUsageFreshness(data, now);
    assert.equal(result.codex.status, "stale");
    assert.equal(result.codex.usageWeekPct, null);
    assert.equal(result.codex.windows[0].usedPercent, null);
    assert.equal(result.codex.windows[0].label, "Week");
    assert.equal(result.timestamp, new Date(now - 180000).toISOString());
    assert.equal(data.codex.usageWeekPct, 28);
  });
  it("does not mark a fresh measured zero stale", () => {
    const data = transformLiveUsageData({
      providers: [{ provider: "openai", windows: [{ label: "5h", usedPercent: 0 }] }],
    });
    assert.equal(applyUsageFreshness(data).codex.usage5hPct, 0);
    assert.equal(applyUsageFreshness(data).stale, false);
  });
});

it("serves valid OpenAI cache alongside Claude errors without repeated CLI requests", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  let calls = 0;
  const context = {
    module: { exports: {} },
    console: { log() {}, error() {} },
    require(name) {
      if (name === "child_process")
        return {
          execFile(_file, _args, _options, callback) {
            calls++;
            callback(
              null,
              JSON.stringify({
                usage: {
                  providers: [
                    { provider: "anthropic", error: "429" },
                    { provider: "openai", windows: [{ label: "Week", usedPercent: 28 }] },
                  ],
                },
              }),
            );
          },
        };
      if (name === "./openclaw") return { getSafeEnv: () => ({}) };
      return require(name);
    },
    process: { env: {} },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/llm-usage.js"), "utf8"), context);
  const api = context.module.exports;
  assert.equal(api.getLlmUsage("/nonexistent").codex.usageWeekPct, 28);
  assert.equal(api.getLlmUsage("/nonexistent").codex.usageWeekPct, 28);
  api.refreshLlmUsageAsync();
  assert.equal(calls, 1);
});
