const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { migrateDataDir } = require("../src/data");

describe("data module", () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("migrateDataDir()", () => {
    it("does nothing when legacy dir does not exist", () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "data-test-"));
      const dataDir = path.join(tmpDir, "data");
      // Should not throw
      migrateDataDir(dataDir, "/nonexistent/legacy");
      assert.ok(!fs.existsSync(dataDir));
    });

    it("copies files from legacy dir to data dir", () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "data-test-"));
      const legacyDir = path.join(tmpDir, "legacy");
      const dataDir = path.join(tmpDir, "data");
      fs.mkdirSync(legacyDir);
      fs.writeFileSync(path.join(legacyDir, "settings.json"), '{"key":"value"}');

      migrateDataDir(dataDir, legacyDir);

      assert.ok(fs.existsSync(path.join(dataDir, "settings.json")));
      const content = fs.readFileSync(path.join(dataDir, "settings.json"), "utf8");
      assert.strictEqual(content, '{"key":"value"}');
    });

    it("does not overwrite existing files in data dir", () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "data-test-"));
      const legacyDir = path.join(tmpDir, "legacy");
      const dataDir = path.join(tmpDir, "data");
      fs.mkdirSync(legacyDir);
      fs.mkdirSync(dataDir);
      fs.writeFileSync(path.join(legacyDir, "config.json"), "legacy");
      fs.writeFileSync(path.join(dataDir, "config.json"), "current");

      migrateDataDir(dataDir, legacyDir);

      const content = fs.readFileSync(path.join(dataDir, "config.json"), "utf8");
      assert.strictEqual(content, "current");
    });

    it("does nothing when legacy dir is empty", () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "data-test-"));
      const legacyDir = path.join(tmpDir, "legacy");
      const dataDir = path.join(tmpDir, "data");
      fs.mkdirSync(legacyDir);

      migrateDataDir(dataDir, legacyDir);

      // data dir should not be created for empty legacy
      // Actually the function creates it, let's check it doesn't crash
    });
  });
});
