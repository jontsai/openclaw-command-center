const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

describe("feed module", () => {
  let tmpDir;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Create a temp directory to act as ~/.openclaw
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "feed-test-"));
    process.env.OPENCLAW_WORKSPACE = path.join(tmpDir, "workspace");
    fs.mkdirSync(process.env.OPENCLAW_WORKSPACE, { recursive: true });

    // Clear require cache so config and feed reload with new env
    for (const key of Object.keys(require.cache)) {
      if (key.includes("config.js") || key.includes("feed.js")) {
        delete require.cache[key];
      }
    }

    // Pre-require feed module so it picks up the temp workspace
    require("../lib/feed");
  });

  afterEach(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);

    // Clear require cache
    for (const key of Object.keys(require.cache)) {
      if (key.includes("config.js") || key.includes("feed.js")) {
        delete require.cache[key];
      }
    }

    // Cleanup tmp
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_e) {
      // ignore cleanup errors
    }
  });

  it("appendEntry writes a valid JSONL line", () => {
    const { appendEntry, getFeedPath } = require("../lib/feed");
    const feedPath = getFeedPath();

    // Clean any pre-existing feed file
    if (fs.existsSync(feedPath)) {
      fs.unlinkSync(feedPath);
    }

    const record = appendEntry({
      type: "session_start",
      severity: "info",
      agentId: "agent-1",
      message: "Session started",
    });

    assert.ok(record.ts > 0, "record should have a timestamp");
    assert.strictEqual(record.type, "session_start");
    assert.strictEqual(record.severity, "info");
    assert.strictEqual(record.message, "Session started");

    // Verify file was written
    const content = fs.readFileSync(feedPath, "utf8");
    const parsed = JSON.parse(content.trim());
    assert.strictEqual(parsed.type, "session_start");

    // Cleanup
    fs.unlinkSync(feedPath);
  });

  it("appendEntry defaults invalid severity to info", () => {
    const { appendEntry, getFeedPath } = require("../lib/feed");
    const feedPath = getFeedPath();
    if (fs.existsSync(feedPath)) fs.unlinkSync(feedPath);

    const record = appendEntry({
      type: "session_start",
      severity: "bogus",
      message: "test",
    });
    assert.strictEqual(record.severity, "info");

    fs.unlinkSync(feedPath);
  });

  it("readEntries returns empty array when no file exists", () => {
    const { readEntries, getFeedPath } = require("../lib/feed");
    const feedPath = getFeedPath();
    if (fs.existsSync(feedPath)) fs.unlinkSync(feedPath);

    const entries = readEntries();
    assert.deepStrictEqual(entries, []);
  });

  it("readEntries returns entries in chronological order", () => {
    const { appendEntry, readEntries, getFeedPath } = require("../lib/feed");
    const feedPath = getFeedPath();
    if (fs.existsSync(feedPath)) fs.unlinkSync(feedPath);

    appendEntry({ type: "session_start", severity: "info", message: "first" });
    appendEntry({ type: "session_end", severity: "info", message: "second" });
    appendEntry({ type: "cron_run", severity: "info", message: "third" });

    const entries = readEntries();
    assert.strictEqual(entries.length, 3);
    assert.strictEqual(entries[0].message, "first");
    assert.strictEqual(entries[2].message, "third");
    assert.ok(entries[0].ts <= entries[2].ts, "entries should be chronological");

    fs.unlinkSync(feedPath);
  });

  it("readEntries respects limit parameter", () => {
    const { appendEntry, readEntries, getFeedPath } = require("../lib/feed");
    const feedPath = getFeedPath();
    if (fs.existsSync(feedPath)) fs.unlinkSync(feedPath);

    for (let i = 0; i < 10; i++) {
      appendEntry({ type: "tool_call", severity: "info", message: `entry-${i}` });
    }

    const entries = readEntries({ limit: 3 });
    assert.strictEqual(entries.length, 3);
    // Should return the LAST 3 entries
    assert.strictEqual(entries[0].message, "entry-7");
    assert.strictEqual(entries[2].message, "entry-9");

    fs.unlinkSync(feedPath);
  });

  it("readEntries filters by since timestamp", () => {
    const { readEntries, getFeedPath } = require("../lib/feed");
    const feedPath = getFeedPath();
    if (fs.existsSync(feedPath)) fs.unlinkSync(feedPath);

    // Write entries with known timestamps
    const now = Date.now();
    const dir = path.dirname(feedPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Manually write entries with controlled timestamps
    const lines = [
      JSON.stringify({ ts: now - 10000, type: "cron_run", severity: "info", message: "old" }),
      JSON.stringify({ ts: now - 5000, type: "cron_run", severity: "info", message: "medium" }),
      JSON.stringify({ ts: now, type: "cron_run", severity: "info", message: "new" }),
    ];
    fs.writeFileSync(feedPath, lines.join("\n") + "\n", "utf8");

    const entries = readEntries({ since: now - 6000 });
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].message, "medium");
    assert.strictEqual(entries[1].message, "new");

    fs.unlinkSync(feedPath);
  });

  it("readEntries handles malformed JSON lines gracefully", () => {
    const { readEntries, getFeedPath } = require("../lib/feed");
    const feedPath = getFeedPath();
    const dir = path.dirname(feedPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const content = [
      JSON.stringify({ ts: Date.now(), type: "info", severity: "info", message: "good" }),
      "this is not json",
      JSON.stringify({ ts: Date.now(), type: "info", severity: "info", message: "also good" }),
    ].join("\n");
    fs.writeFileSync(feedPath, content + "\n", "utf8");

    const entries = readEntries();
    assert.strictEqual(entries.length, 2);

    fs.unlinkSync(feedPath);
  });
});
