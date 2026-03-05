const { describe, it } = require("node:test");
const assert = require("node:assert");
const { extractJSON } = require("../src/openclaw");

describe("openclaw module", () => {
  describe("extractJSON()", () => {
    it("returns null for null input", () => {
      assert.strictEqual(extractJSON(null), null);
    });

    it("returns null for empty string", () => {
      assert.strictEqual(extractJSON(""), null);
    });

    it("returns null for non-JSON text", () => {
      assert.strictEqual(extractJSON("no json here"), null);
    });

    it("extracts JSON object from clean input", () => {
      const result = extractJSON('{"key": "value"}');
      assert.strictEqual(result, '{"key": "value"}');
    });

    it("extracts JSON array from clean input", () => {
      const result = extractJSON("[1, 2, 3]");
      assert.strictEqual(result, "[1, 2, 3]");
    });

    it("strips non-JSON prefix from output", () => {
      const result = extractJSON('Some warning text\n{"key": "value"}');
      assert.strictEqual(result, '{"key": "value"}');
    });

    it("handles prefix with special characters", () => {
      const result = extractJSON('Doctor warnings: OK\n[{"id": 1}]');
      assert.strictEqual(result, '[{"id": 1}]');
    });
  });
});
