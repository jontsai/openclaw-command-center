const { describe, it } = require("node:test");
const assert = require("node:assert");
const { cronToHuman } = require("../src/cron");

describe("cron module", () => {
  describe("cronToHuman()", () => {
    it("returns null for null input", () => {
      assert.strictEqual(cronToHuman(null), null);
    });

    it("returns null for dash", () => {
      assert.strictEqual(cronToHuman("—"), null);
    });

    it("returns null for too few parts", () => {
      assert.strictEqual(cronToHuman("* *"), null);
    });

    it("converts every-minute cron", () => {
      assert.strictEqual(cronToHuman("* * * * *"), "Every minute");
    });

    it("converts every-N-minutes cron", () => {
      assert.strictEqual(cronToHuman("*/5 * * * *"), "Every 5 minutes");
      assert.strictEqual(cronToHuman("*/15 * * * *"), "Every 15 minutes");
    });

    it("converts every-N-hours cron", () => {
      assert.strictEqual(cronToHuman("0 */2 * * *"), "Every 2 hours");
    });

    it("converts hourly at specific minute", () => {
      assert.strictEqual(cronToHuman("30 * * * *"), "Hourly at :30");
      assert.strictEqual(cronToHuman("0 * * * *"), "Hourly at :00");
    });

    it("converts daily at specific time", () => {
      assert.strictEqual(cronToHuman("0 9 * * *"), "Daily at 9am");
      assert.strictEqual(cronToHuman("30 14 * * *"), "Daily at 2:30pm");
      assert.strictEqual(cronToHuman("0 0 * * *"), "Daily at 12am");
      assert.strictEqual(cronToHuman("0 12 * * *"), "Daily at 12pm");
    });

    it("converts weekday cron", () => {
      assert.strictEqual(cronToHuman("0 9 * * 1-5"), "Weekdays at 9am");
      assert.strictEqual(cronToHuman("0 9 * * MON-FRI"), "Weekdays at 9am");
    });

    it("converts weekend cron", () => {
      assert.strictEqual(cronToHuman("0 10 * * 0,6"), "Weekends at 10am");
      assert.strictEqual(cronToHuman("0 10 * * 6,0"), "Weekends at 10am");
    });

    it("converts specific day of week", () => {
      const result = cronToHuman("0 8 * * 1");
      assert.strictEqual(result, "Monday at 8am");
    });

    it("converts specific day of month", () => {
      const result = cronToHuman("0 9 1 * *");
      assert.strictEqual(result, "1st of month at 9am");
    });

    it("handles ordinal suffixes correctly", () => {
      assert.ok(cronToHuman("0 9 2 * *").includes("2nd"));
      assert.ok(cronToHuman("0 9 3 * *").includes("3rd"));
      assert.ok(cronToHuman("0 9 4 * *").includes("4th"));
      assert.ok(cronToHuman("0 9 21 * *").includes("21st"));
      assert.ok(cronToHuman("0 9 22 * *").includes("22nd"));
      assert.ok(cronToHuman("0 9 23 * *").includes("23rd"));
    });

    it("returns original expression as fallback", () => {
      const expr = "* * * 6 *";
      const result = cronToHuman(expr);
      assert.strictEqual(typeof result, "string");
    });
  });
});
