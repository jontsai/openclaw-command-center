const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

describe("salesforce-zombie module", () => {
  let tmpDir;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zombie-test-"));
    process.env.OPENCLAW_WORKSPACE = path.join(tmpDir, "workspace");
    fs.mkdirSync(process.env.OPENCLAW_WORKSPACE, { recursive: true });

    // Clear require cache so config, feed, db, and salesforce-zombie reload
    for (const key of Object.keys(require.cache)) {
      if (
        key.includes("config.js") ||
        key.includes("feed.js") ||
        key.includes("db.js") ||
        key.includes("salesforce-zombie.js")
      ) {
        delete require.cache[key];
      }
    }
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);

    for (const key of Object.keys(require.cache)) {
      if (
        key.includes("config.js") ||
        key.includes("feed.js") ||
        key.includes("db.js") ||
        key.includes("salesforce-zombie.js")
      ) {
        delete require.cache[key];
      }
    }

    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_e) {
      // ignore cleanup errors
    }
  });

  // ── isZombie ──────────────────────────────────────────────

  it("flags lead with >60 days inactivity and no sequence as zombie", () => {
    const { isZombie, MS_PER_DAY } = require("../lib/salesforce-zombie");
    const now = Date.now();
    const lead = {
      lastActivityDate: new Date(now - 61 * MS_PER_DAY).toISOString(),
      hasActiveSequence: false,
    };
    assert.strictEqual(isZombie(lead, now), true);
  });

  it("does NOT flag lead with recent activity", () => {
    const { isZombie, MS_PER_DAY } = require("../lib/salesforce-zombie");
    const now = Date.now();
    const lead = {
      lastActivityDate: new Date(now - 30 * MS_PER_DAY).toISOString(),
      hasActiveSequence: false,
    };
    assert.strictEqual(isZombie(lead, now), false);
  });

  it("does NOT flag lead with active sequence even if stale", () => {
    const { isZombie, MS_PER_DAY } = require("../lib/salesforce-zombie");
    const now = Date.now();
    const lead = {
      lastActivityDate: new Date(now - 90 * MS_PER_DAY).toISOString(),
      hasActiveSequence: true,
    };
    assert.strictEqual(isZombie(lead, now), false);
  });

  it("returns false for null/undefined lead", () => {
    const { isZombie } = require("../lib/salesforce-zombie");
    assert.strictEqual(isZombie(null), false);
    assert.strictEqual(isZombie(undefined), false);
  });

  it("returns false when lastActivityDate is missing", () => {
    const { isZombie } = require("../lib/salesforce-zombie");
    assert.strictEqual(isZombie({ name: "Test" }), false);
  });

  it("handles numeric epoch-ms lastActivityDate", () => {
    const { isZombie, MS_PER_DAY } = require("../lib/salesforce-zombie");
    const now = Date.now();
    const lead = {
      lastActivityDate: now - 100 * MS_PER_DAY,
      hasActiveSequence: false,
    };
    assert.strictEqual(isZombie(lead, now), true);
  });

  it("returns false for invalid date string", () => {
    const { isZombie } = require("../lib/salesforce-zombie");
    assert.strictEqual(isZombie({ lastActivityDate: "not-a-date" }), false);
  });

  // ── evaluateLeads ─────────────────────────────────────────

  it("filters an array of leads to only zombies", () => {
    const { evaluateLeads, MS_PER_DAY } = require("../lib/salesforce-zombie");
    const now = Date.now();
    const leads = [
      { id: "1", lastActivityDate: new Date(now - 90 * MS_PER_DAY).toISOString() },
      { id: "2", lastActivityDate: new Date(now - 10 * MS_PER_DAY).toISOString() },
      { id: "3", lastActivityDate: new Date(now - 61 * MS_PER_DAY).toISOString() },
      {
        id: "4",
        lastActivityDate: new Date(now - 120 * MS_PER_DAY).toISOString(),
        hasActiveSequence: true,
      },
    ];

    const zombies = evaluateLeads(leads, now);
    assert.strictEqual(zombies.length, 2);
    assert.deepStrictEqual(
      zombies.map((z) => z.id),
      ["1", "3"],
    );
  });

  it("returns empty array for non-array input", () => {
    const { evaluateLeads } = require("../lib/salesforce-zombie");
    assert.deepStrictEqual(evaluateLeads(null), []);
    assert.deepStrictEqual(evaluateLeads("bad"), []);
  });

  // ── postZombieAlerts ──────────────────────────────────────

  it("posts critical feed entries for each zombie lead", () => {
    const { postZombieAlerts, MS_PER_DAY } = require("../lib/salesforce-zombie");
    const { getFeedPath } = require("../lib/feed");
    const feedPath = getFeedPath();
    if (fs.existsSync(feedPath)) fs.unlinkSync(feedPath);

    const now = Date.now();
    const leads = [
      { id: "lead-1", name: "Acme Corp", lastActivityDate: new Date(now - 90 * MS_PER_DAY).toISOString() },
      { id: "lead-2", name: "Globex", lastActivityDate: new Date(now - 5 * MS_PER_DAY).toISOString() },
    ];

    const records = postZombieAlerts(leads, now);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].type, "zombie_risk");
    assert.strictEqual(records[0].severity, "critical");
    assert.ok(records[0].message.includes("Acme Corp"));
    assert.strictEqual(records[0].meta.leadId, "lead-1");

    // Verify written to JSONL (parse last line — file may have multiple entries)
    const raw = fs.readFileSync(feedPath, "utf8").trim();
    const lines = raw.split("\n").filter(Boolean);
    const parsed = JSON.parse(lines[lines.length - 1]);
    assert.strictEqual(parsed.type, "zombie_risk");

    fs.unlinkSync(feedPath);
  });

  it("returns empty array when no zombies found", () => {
    const { postZombieAlerts, MS_PER_DAY } = require("../lib/salesforce-zombie");
    const now = Date.now();
    const leads = [
      { id: "1", lastActivityDate: new Date(now - 10 * MS_PER_DAY).toISOString() },
    ];

    const records = postZombieAlerts(leads, now);
    assert.strictEqual(records.length, 0);
  });

  // ── zombie_risk event type registration ───────────────────

  it("registers zombie_risk as a valid feed event type", () => {
    require("../lib/salesforce-zombie");
    const { VALID_TYPES } = require("../lib/feed");
    assert.ok(VALID_TYPES.has("zombie_risk"));
  });
});
