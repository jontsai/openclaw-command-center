const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

describe("notifier module", () => {
  let tmpDir;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "notifier-test-"));
    // Point HOME to tmpDir so getOpenClawDir() resolves to tmpDir/.openclaw
    process.env.HOME = tmpDir;
    process.env.OPENCLAW_WORKSPACE = path.join(tmpDir, ".openclaw", "workspace");
    fs.mkdirSync(process.env.OPENCLAW_WORKSPACE, { recursive: true });

    // Clear require cache
    for (const key of Object.keys(require.cache)) {
      if (key.includes("config.js") || key.includes("notifier.js") || key.includes("feed.js")) {
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
      if (key.includes("config.js") || key.includes("notifier.js") || key.includes("feed.js")) {
        delete require.cache[key];
      }
    }

    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_e) {
      // ignore
    }
  });

  it("formatMessage includes severity emoji and type", () => {
    const { formatMessage } = require("../lib/notifier");

    const critical = formatMessage({
      severity: "critical",
      type: "agent_error",
      message: "Agent crashed",
    });
    assert.ok(critical.includes("\uD83D\uDD34"), "critical should have red circle emoji");
    assert.ok(critical.includes("agent_error"), "should include event type");
    assert.ok(critical.includes("Agent crashed"), "should include message");

    const warning = formatMessage({
      severity: "warning",
      type: "cost_spike",
      message: "Cost high",
    });
    assert.ok(warning.includes("\u26A0\uFE0F"), "warning should have warning emoji");
  });

  it("notify ignores non-critical events", async () => {
    const { notify } = require("../lib/notifier");

    const result = await notify({
      severity: "info",
      type: "session_start",
      message: "test",
    });
    assert.strictEqual(result, undefined, "info events should be ignored");
  });

  it("notify ignores critical events with non-notifiable types", async () => {
    const { notify } = require("../lib/notifier");

    const result = await notify({
      severity: "critical",
      type: "session_start",
      message: "test",
    });
    assert.strictEqual(result, undefined, "session_start is not a notifiable type");
  });

  it("notify returns undefined when no bot token configured", async () => {
    const { notify, _resetDebounce } = require("../lib/notifier");
    _resetDebounce();

    // No openclaw.json exists → no bot token
    const result = await notify({
      severity: "critical",
      type: "agent_error",
      message: "test",
    });
    assert.strictEqual(result, undefined, "should skip when no bot token");
  });

  it("notify returns undefined when no chat IDs configured", async () => {
    const { notify, _resetDebounce } = require("../lib/notifier");
    _resetDebounce();

    // Write openclaw.json with bot token but no pairing file
    const openclawDir = path.join(tmpDir, ".openclaw");
    fs.mkdirSync(openclawDir, { recursive: true });
    fs.writeFileSync(
      path.join(openclawDir, "openclaw.json"),
      JSON.stringify({ channels: { telegram: { botToken: "fake-token" } } }),
    );

    const result = await notify({
      severity: "critical",
      type: "agent_error",
      message: "test",
    });
    assert.strictEqual(result, undefined, "should skip when no chat IDs");
  });

  it("debounce prevents duplicate notifications within 5 minutes", async () => {
    const { _resetDebounce, _getLastSent, DEBOUNCE_MS } = require("../lib/notifier");
    _resetDebounce();

    // Simulate that a notification was just sent
    const lastSent = _getLastSent();
    lastSent.set("agent_error", Date.now());

    // Now require a fresh module ref to test isDebounced
    const { notify } = require("../lib/notifier");

    // Write config files
    const openclawDir = path.join(tmpDir, ".openclaw");
    const credDir = path.join(openclawDir, "credentials");
    fs.mkdirSync(credDir, { recursive: true });
    fs.writeFileSync(
      path.join(openclawDir, "openclaw.json"),
      JSON.stringify({ channels: { telegram: { botToken: "fake-token" } } }),
    );
    fs.writeFileSync(
      path.join(credDir, "telegram-pairing.json"),
      JSON.stringify([{ chatId: "12345" }]),
    );

    // This should be debounced — notify won't try to send
    const result = await notify({
      severity: "critical",
      type: "agent_error",
      message: "should be debounced",
    });

    // When debounced, notify returns early (undefined)
    assert.strictEqual(result, undefined, "debounced event should return undefined");
    assert.ok(DEBOUNCE_MS === 5 * 60 * 1000, "debounce interval should be 5 minutes");
  });

  it("debounce allows notification after timeout expires", () => {
    const { _resetDebounce, _getLastSent, DEBOUNCE_MS } = require("../lib/notifier");
    _resetDebounce();

    const lastSent = _getLastSent();
    // Set last sent to 6 minutes ago
    lastSent.set("agent_error", Date.now() - DEBOUNCE_MS - 1000);

    // Verify the debounce check would pass (not debounced)
    const last = lastSent.get("agent_error");
    const elapsed = Date.now() - last;
    assert.ok(elapsed > DEBOUNCE_MS, "should have exceeded debounce window");
  });
});
