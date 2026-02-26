const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

function makeTempEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zsched-test-"));
  const wsDir = path.join(dir, "workspace");
  fs.mkdirSync(wsDir, { recursive: true });
  return { dir, wsDir };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Load zombie-scheduler with a fresh require cache and
 * overridden OPENCLAW_HOME so it writes to a temp dir.
 */
function loadScheduler(tempDir) {
  // Clear all relevant module caches
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes("zombie-scheduler") ||
      key.includes("salesforce-zombie") ||
      key.includes("feed") ||
      key.includes("config") ||
      key.includes("db") ||
      key.includes("notifier")
    ) {
      delete require.cache[key];
    }
  }

  // Set env so config module picks up temp dir
  process.env.OPENCLAW_HOME = tempDir;
  // Clear Salesforce env vars to force mock data
  delete process.env.SALESFORCE_INSTANCE_URL;
  delete process.env.SALESFORCE_ACCESS_TOKEN;

  return require("../lib/zombie-scheduler");
}

describe("zombie-scheduler module", () => {
  describe("msUntilNextFriday1700()", () => {
    it("calculates correct time to next Friday from a Monday", () => {
      // Monday 2026-02-23 at 09:00
      const monday = new Date(2026, 1, 23, 9, 0, 0, 0);
      const { dir } = makeTempEnv();
      try {
        const sched = loadScheduler(dir);
        const ms = sched.msUntilNextFriday1700(monday);

        // Friday is 4 days + 8 hours = 4*24 + 8 = 104 hours
        const hours = ms / (60 * 60 * 1000);
        assert.ok(hours > 103 && hours < 105, `Expected ~104 hours, got ${hours}`);
      } finally {
        cleanup(dir);
      }
    });

    it("returns next week if Friday 17:00 has already passed", () => {
      // Friday 2026-02-27 at 18:00 (past 17:00)
      const fridayEvening = new Date(2026, 1, 27, 18, 0, 0, 0);
      const { dir } = makeTempEnv();
      try {
        const sched = loadScheduler(dir);
        const ms = sched.msUntilNextFriday1700(fridayEvening);

        // Should be ~6 days 23 hours = ~167 hours
        const hours = ms / (60 * 60 * 1000);
        assert.ok(hours > 166 && hours < 168, `Expected ~167 hours, got ${hours}`);
      } finally {
        cleanup(dir);
      }
    });

    it("returns same-day ms if Friday before 17:00", () => {
      // Friday 2026-02-27 at 10:00
      const fridayMorning = new Date(2026, 1, 27, 10, 0, 0, 0);
      const { dir } = makeTempEnv();
      try {
        const sched = loadScheduler(dir);
        const ms = sched.msUntilNextFriday1700(fridayMorning);

        // Should be 7 hours
        const hours = ms / (60 * 60 * 1000);
        assert.ok(hours > 6.9 && hours < 7.1, `Expected ~7 hours, got ${hours}`);
      } finally {
        cleanup(dir);
      }
    });
  });

  describe("formatSummary()", () => {
    it("includes all stats fields in the formatted output", () => {
      const { dir } = makeTempEnv();
      try {
        const sched = loadScheduler(dir);
        const summary = sched.formatSummary({
          leadsScanned: 150,
          newZombies: 12,
          highRisk: 3,
        });

        assert.ok(summary.includes("Friday Zombie Report"));
        assert.ok(summary.includes("150"), "includes leads scanned");
        assert.ok(summary.includes("12"), "includes new zombies");
        assert.ok(summary.includes(" 3"), "includes high risk");
        assert.ok(summary.includes("localhost:3000/dashboard"));
      } finally {
        cleanup(dir);
      }
    });

    it("pads single-digit numbers correctly", () => {
      const { dir } = makeTempEnv();
      try {
        const sched = loadScheduler(dir);
        const summary = sched.formatSummary({
          leadsScanned: 5,
          newZombies: 1,
          highRisk: 0,
        });
        assert.ok(summary.includes("  5"), "leads scanned padded");
        assert.ok(summary.includes(" 1"), "new zombies padded");
        assert.ok(summary.includes(" 0"), "high risk padded");
      } finally {
        cleanup(dir);
      }
    });
  });

  describe("runZombieScan()", () => {
    it("falls back to mock data when Salesforce env vars are absent", async () => {
      const { dir } = makeTempEnv();
      try {
        const sched = loadScheduler(dir);
        const stats = await sched.runZombieScan();

        assert.equal(stats.leadsScanned, sched.MOCK_LEADS.length);
        assert.ok(stats.newZombies >= 0);
        assert.ok(stats.highRisk >= 0);
      } finally {
        cleanup(dir);
      }
    });

    it("writes to SQLite sync_log after scan", async () => {
      const { dir } = makeTempEnv();
      try {
        const sched = loadScheduler(dir);
        // Need fresh db module with the temp env
        const db = require("../lib/db");

        await sched.runZombieScan();

        const logs = db.querySyncLog({});
        assert.ok(logs.length >= 1, "at least one sync_log entry");
        assert.equal(logs[0].source, "mock");
      } finally {
        cleanup(dir);
      }
    });
  });

  describe("MOCK_LEADS", () => {
    it("contains a mix of zombie and non-zombie leads", () => {
      const { dir } = makeTempEnv();
      try {
        const sched = loadScheduler(dir);
        const { evaluateLeads } = require("../lib/salesforce-zombie");

        const zombies = evaluateLeads(sched.MOCK_LEADS);
        assert.ok(zombies.length > 0, "some leads are zombies");
        assert.ok(zombies.length < sched.MOCK_LEADS.length, "not all leads are zombies");
      } finally {
        cleanup(dir);
      }
    });
  });
});
