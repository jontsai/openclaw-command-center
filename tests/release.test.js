const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const checker = path.resolve(__dirname, "../scripts/release-check.js");
for (const dashboard of [true, false]) {
  test(`release staging protects source and excludes local data (${dashboard ? "dashboard" : "workspace"})`, () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "release-test-"));
    try {
      const root = path.join(temp, "source");
      fs.mkdirSync(root);
      fs.mkdirSync(path.join(root, "scripts"));
      fs.copyFileSync(checker, path.join(root, "scripts/release-check.js"));
      const put = (name, value) => fs.writeFileSync(path.join(root, name), value);
      const version = "1.5.0-rc.1";
      if (dashboard) {
        put("package.json", JSON.stringify({ version }));
        put("package-lock.json", JSON.stringify({ version, packages: { "": { version } } }));
        put("SKILL.md", `---\nversion: ${version}\n---\n`);
      } else {
        put("VERSION", version);
        put("version.txt", version);
        put("SKILL.md", `| **Version** | \`${version}\` |\n`);
      }
      put("CHANGELOG.md", `## [${version}]\n`);
      put(".gitignore", ".env\n");
      const git = (...args) =>
        execFileSync("git", args, {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }).trim();
      git("init");
      git("add", ".");
      git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "-m",
        "fixture",
      );
      const before = git("rev-parse", "HEAD");
      put(".env", "SYNTHETIC_LOCAL_ONLY=1\n");
      const run = (...args) =>
        spawnSync(process.execPath, [path.join(root, "scripts/release-check.js"), ...args], {
          encoding: "utf8",
        });
      assert.equal(run(version).status, 0);
      for (const bad of ["1.5.0-rc.01", "01.5.0", "1.5.0"]) assert.notEqual(run(bad).status, 0);
      const stage = path.join(temp, "artifact");
      assert.equal(run(version, "--stage", stage).status, 0);
      assert.equal(fs.existsSync(path.join(stage, ".env")), false);
      assert.equal(
        fs.readFileSync(path.join(stage, "SKILL.md"), "utf8"),
        fs.readFileSync(path.join(root, "SKILL.md"), "utf8"),
      );
      assert.notEqual(run(version, "--stage", stage).status, 0);
      put("CHANGELOG.md", `## [${version}]\nchanged`);
      assert.notEqual(run(version, "--stage", path.join(temp, "dirty")).status, 0);
      assert.equal(git("rev-parse", "HEAD"), before);
      assert.equal(git("tag"), "");
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
}
