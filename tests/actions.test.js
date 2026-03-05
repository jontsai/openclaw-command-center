const { describe, it } = require("node:test");
const assert = require("node:assert");
const { executeAction } = require("../src/actions");

describe("actions module", () => {
  describe("executeAction()", () => {
    const mockDeps = {
      runOpenClaw: (args) => `mock output for: ${args}`,
      extractJSON: (output) => output,
      PORT: 3333,
    };

    it("handles gateway-status action", () => {
      const result = executeAction("gateway-status", mockDeps);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.action, "gateway-status");
      assert.ok(result.output.includes("gateway status"));
    });

    it("handles gateway-restart action with safety message", () => {
      const result = executeAction("gateway-restart", mockDeps);
      assert.strictEqual(result.success, true);
      assert.ok(result.note.includes("safety"));
    });

    it("handles sessions-list action", () => {
      const result = executeAction("sessions-list", mockDeps);
      assert.strictEqual(result.success, true);
    });

    it("handles cron-list action", () => {
      const result = executeAction("cron-list", mockDeps);
      assert.strictEqual(result.success, true);
    });

    it("handles health-check action", () => {
      const result = executeAction("health-check", mockDeps);
      assert.strictEqual(result.success, true);
      assert.ok(result.output.includes("Dashboard"));
      assert.ok(result.output.includes("3333"));
    });

    it("handles clear-stale-sessions action", () => {
      const deps = {
        ...mockDeps,
        runOpenClaw: () => '{"sessions": []}',
        extractJSON: (o) => o,
      };
      const result = executeAction("clear-stale-sessions", deps);
      assert.strictEqual(result.success, true);
      assert.ok(result.output.includes("stale sessions"));
    });

    it("returns error for unknown action", () => {
      const result = executeAction("nonexistent-action", mockDeps);
      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes("Unknown action"));
    });

    it("handles runOpenClaw returning null", () => {
      const deps = { ...mockDeps, runOpenClaw: () => null };
      const result = executeAction("gateway-status", deps);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.output, "Unknown");
    });

    it("catches exceptions and returns error", () => {
      const deps = {
        ...mockDeps,
        runOpenClaw: () => {
          throw new Error("command failed");
        },
      };
      const result = executeAction("gateway-status", deps);
      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes("command failed"));
    });
  });
});
