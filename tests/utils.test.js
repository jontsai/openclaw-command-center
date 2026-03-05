const { describe, it } = require("node:test");
const assert = require("node:assert");
const { formatBytes, formatTimeAgo, formatNumber, formatTokens } = require("../src/utils");

describe("utils module", () => {
  describe("formatBytes()", () => {
    it("formats bytes", () => {
      assert.strictEqual(formatBytes(500), "500 B");
    });

    it("formats kilobytes", () => {
      assert.strictEqual(formatBytes(1024), "1.0 KB");
      assert.strictEqual(formatBytes(1536), "1.5 KB");
    });

    it("formats megabytes", () => {
      assert.strictEqual(formatBytes(1048576), "1.0 MB");
    });

    it("formats gigabytes", () => {
      assert.strictEqual(formatBytes(1073741824), "1.0 GB");
    });

    it("formats terabytes", () => {
      assert.strictEqual(formatBytes(1099511627776), "1.0 TB");
    });
  });

  describe("formatTimeAgo()", () => {
    it("formats just now", () => {
      assert.strictEqual(formatTimeAgo(new Date()), "just now");
    });

    it("formats minutes ago", () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      assert.strictEqual(formatTimeAgo(fiveMinAgo), "5m ago");
    });

    it("formats hours ago", () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      assert.strictEqual(formatTimeAgo(twoHoursAgo), "2h ago");
    });

    it("formats days ago", () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      assert.strictEqual(formatTimeAgo(threeDaysAgo), "3d ago");
    });
  });

  describe("formatNumber()", () => {
    it("formats with 2 decimal places", () => {
      assert.strictEqual(formatNumber(1234.5), "1,234.50");
    });

    it("formats zero", () => {
      assert.strictEqual(formatNumber(0), "0.00");
    });

    it("formats small numbers", () => {
      assert.strictEqual(formatNumber(0.1), "0.10");
    });
  });

  describe("formatTokens()", () => {
    it("formats millions", () => {
      assert.strictEqual(formatTokens(1500000), "1.5M");
    });

    it("formats thousands", () => {
      assert.strictEqual(formatTokens(2500), "2.5k");
    });

    it("formats small numbers as-is", () => {
      assert.strictEqual(formatTokens(42), "42");
    });

    it("formats exactly 1M", () => {
      assert.strictEqual(formatTokens(1000000), "1.0M");
    });

    it("formats exactly 1k", () => {
      assert.strictEqual(formatTokens(1000), "1.0k");
    });
  });
});
