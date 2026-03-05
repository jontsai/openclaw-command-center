const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { loadPrivacySettings, savePrivacySettings } = require("../src/privacy");

describe("privacy module", () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("loadPrivacySettings()", () => {
    it("returns defaults when file does not exist", () => {
      const settings = loadPrivacySettings("/nonexistent/path");
      assert.strictEqual(settings.version, 1);
      assert.deepStrictEqual(settings.hiddenTopics, []);
      assert.deepStrictEqual(settings.hiddenSessions, []);
      assert.deepStrictEqual(settings.hiddenCrons, []);
      assert.strictEqual(settings.hideHostname, false);
      assert.strictEqual(settings.updatedAt, null);
    });

    it("loads settings from file", () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-test-"));
      const data = {
        version: 1,
        hiddenTopics: ["secret"],
        hiddenSessions: [],
        hiddenCrons: [],
        hideHostname: true,
        updatedAt: "2024-01-01",
      };
      fs.writeFileSync(path.join(tmpDir, "privacy-settings.json"), JSON.stringify(data));
      const settings = loadPrivacySettings(tmpDir);
      assert.deepStrictEqual(settings.hiddenTopics, ["secret"]);
      assert.strictEqual(settings.hideHostname, true);
    });
  });

  describe("savePrivacySettings()", () => {
    it("saves settings to file", () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-test-"));
      const data = {
        version: 1,
        hiddenTopics: ["topic1"],
        hiddenSessions: [],
        hiddenCrons: [],
        hideHostname: false,
      };
      const result = savePrivacySettings(tmpDir, data);
      assert.strictEqual(result, true);

      const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, "privacy-settings.json"), "utf8"));
      assert.deepStrictEqual(saved.hiddenTopics, ["topic1"]);
      assert.ok(saved.updatedAt);
    });

    it("creates directory if it does not exist", () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-test-"));
      const nestedDir = path.join(tmpDir, "nested", "dir");
      const data = {
        version: 1,
        hiddenTopics: [],
        hiddenSessions: [],
        hiddenCrons: [],
        hideHostname: false,
      };
      const result = savePrivacySettings(nestedDir, data);
      assert.strictEqual(result, true);
      assert.ok(fs.existsSync(path.join(nestedDir, "privacy-settings.json")));
    });
  });
});
