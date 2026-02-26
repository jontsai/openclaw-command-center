const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Each test gets its own temp directory + DB
function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-test-"));
  const dbPath = path.join(dir, "test.db");
  return { dir, dbPath };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Fresh require of db module
function loadDb() {
  const modPath = require.resolve("../lib/db");
  delete require.cache[modPath];
  return require("../lib/db");
}

describe("db module", () => {
  let db;

  before(() => {
    db = loadDb();
  });

  describe("ensureSchema()", () => {
    it("creates all three tables without error", () => {
      const { dir, dbPath } = makeTempDb();
      try {
        db.ensureSchema(dbPath);
        // Verify tables exist by querying sqlite_master
        const tables = db.query(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;",
          dbPath,
        );
        const names = tables.map((r) => r.name);
        assert.ok(names.includes("zombie_alerts"), "zombie_alerts table exists");
        assert.ok(names.includes("feed_events"), "feed_events table exists");
        assert.ok(names.includes("sync_log"), "sync_log table exists");
      } finally {
        cleanup(dir);
      }
    });

    it("is idempotent — calling twice does not error", () => {
      const { dir, dbPath } = makeTempDb();
      try {
        db.ensureSchema(dbPath);
        db.ensureSchema(dbPath);
        const tables = db.query(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;",
          dbPath,
        );
        assert.ok(tables.length >= 3);
      } finally {
        cleanup(dir);
      }
    });
  });

  describe("insertFeedEvent() + queryFeedEvents()", () => {
    it("inserts and retrieves a feed event", () => {
      const { dir, dbPath } = makeTempDb();
      try {
        db.ensureSchema(dbPath);
        db.insertFeedEvent(
          {
            ts: 1000,
            type: "cron_run",
            severity: "info",
            message: "Test event",
            meta: { key: "value" },
          },
          dbPath,
        );
        const rows = db.queryFeedEvents({}, dbPath);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].type, "cron_run");
        assert.equal(rows[0].message, "Test event");
      } finally {
        cleanup(dir);
      }
    });

    it("respects since filter", () => {
      const { dir, dbPath } = makeTempDb();
      try {
        db.ensureSchema(dbPath);
        db.insertFeedEvent({ ts: 100, type: "a", severity: "info", message: "old", meta: null }, dbPath);
        db.insertFeedEvent({ ts: 200, type: "b", severity: "info", message: "new", meta: null }, dbPath);
        const rows = db.queryFeedEvents({ since: 150 }, dbPath);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].type, "b");
      } finally {
        cleanup(dir);
      }
    });

    it("respects limit", () => {
      const { dir, dbPath } = makeTempDb();
      try {
        db.ensureSchema(dbPath);
        for (let i = 0; i < 5; i++) {
          db.insertFeedEvent({ ts: i, type: "x", severity: "info", message: `msg${i}`, meta: null }, dbPath);
        }
        const rows = db.queryFeedEvents({ limit: 2 }, dbPath);
        assert.equal(rows.length, 2);
      } finally {
        cleanup(dir);
      }
    });
  });

  describe("insertZombieAlert() + queryZombieAlerts()", () => {
    it("inserts and retrieves a zombie alert", () => {
      const { dir, dbPath } = makeTempDb();
      try {
        db.ensureSchema(dbPath);
        db.insertZombieAlert(
          {
            salesforce_id: "SF001",
            lead_name: "Acme Corp",
            days_inactive: 90,
            high_risk: true,
            alert_sent_at: 5000,
            week_of: "2026-W09",
          },
          dbPath,
        );
        const rows = db.queryZombieAlerts({}, dbPath);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].lead_name, "Acme Corp");
        assert.equal(rows[0].salesforce_id, "SF001");
      } finally {
        cleanup(dir);
      }
    });
  });

  describe("insertSyncLog() + querySyncLog()", () => {
    it("inserts and retrieves a sync log entry", () => {
      const { dir, dbPath } = makeTempDb();
      try {
        db.ensureSchema(dbPath);
        db.insertSyncLog(
          {
            run_at: 9999,
            leads_scanned: 100,
            new_zombies: 5,
            high_risk: 2,
            source: "scheduler",
          },
          dbPath,
        );
        const rows = db.querySyncLog({}, dbPath);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].source, "scheduler");
      } finally {
        cleanup(dir);
      }
    });
  });

  describe("feedEventExists()", () => {
    it("returns true for existing ts+type", () => {
      const { dir, dbPath } = makeTempDb();
      try {
        db.ensureSchema(dbPath);
        db.insertFeedEvent({ ts: 42, type: "cron_run", severity: "info", message: "hi", meta: null }, dbPath);
        assert.ok(db.feedEventExists(42, "cron_run", dbPath));
      } finally {
        cleanup(dir);
      }
    });

    it("returns false for non-existing event", () => {
      const { dir, dbPath } = makeTempDb();
      try {
        db.ensureSchema(dbPath);
        assert.ok(!db.feedEventExists(999, "missing", dbPath));
      } finally {
        cleanup(dir);
      }
    });
  });

  describe("migration idempotency", () => {
    it("inserting the same event twice and checking exists prevents duplicates", () => {
      const { dir, dbPath } = makeTempDb();
      try {
        db.ensureSchema(dbPath);
        const evt = { ts: 777, type: "agent_error", severity: "critical", message: "boom", meta: null };
        db.insertFeedEvent(evt, dbPath);

        // Simulate migration: check before insert
        if (!db.feedEventExists(777, "agent_error", dbPath)) {
          db.insertFeedEvent(evt, dbPath);
        }

        const rows = db.queryFeedEvents({}, dbPath);
        assert.equal(rows.length, 1, "only one row exists (deduplication worked)");
      } finally {
        cleanup(dir);
      }
    });
  });

  describe("esc()", () => {
    it("escapes null to NULL", () => {
      assert.equal(db.esc(null), "NULL");
    });

    it("escapes undefined to NULL", () => {
      assert.equal(db.esc(undefined), "NULL");
    });

    it("escapes numbers as-is", () => {
      assert.equal(db.esc(42), "42");
    });

    it("escapes strings with single quotes", () => {
      assert.equal(db.esc("hello"), "'hello'");
    });

    it("doubles internal single quotes", () => {
      assert.equal(db.esc("it's"), "'it''s'");
    });
  });
});
