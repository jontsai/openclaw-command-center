#!/usr/bin/env node
// Read-only release checks and tracked-file artifact staging. Never tags or publishes.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}
function main() {
  const args = process.argv.slice(2);
  const version = args.shift();
  const semver =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
  if (!version || !semver.test(version))
    throw new Error("Supply a valid SemVer version, e.g. 1.5.0 or 1.5.0-rc.1");
  const stage = args[0] === "--stage" && args.length === 2 ? args[1] : null;
  if (args.length && !stage)
    throw new Error(
      "Usage: release.sh VERSION [--stage NEW_DIRECTORY]; publication is a separate reviewed action",
    );
  const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
  const isDashboard = fs.existsSync(path.join(root, "package.json"));
  const versions = isDashboard
    ? [
        JSON.parse(read("package.json")).version,
        JSON.parse(read("package-lock.json")).version,
        JSON.parse(read("package-lock.json")).packages[""].version,
        read("SKILL.md").match(/^version: (.+)$/m)?.[1],
      ]
    : [
        read("VERSION").trim(),
        read("version.txt").trim(),
        read("SKILL.md").match(/\*\*Version\*\* \| `([^`]+)`/)?.[1],
      ];
  if (versions.some((v) => v !== version))
    throw new Error("Version metadata mismatch; prepare a reviewed version bump first");
  if (!read("CHANGELOG.md").includes(`## [${version}]`)) throw new Error("Missing changelog entry");
  if (stage) {
    if (git("status", "--porcelain", "--untracked-files=no").trim())
      throw new Error("Commit reviewed changes before staging an immutable artifact");
    const destination = path.resolve(stage);
    if (destination === root || destination.startsWith(root + path.sep))
      throw new Error("Stage outside the source checkout");
    const common =
      /^(README(?:\.[a-zA-Z-]+)?\.md|SKILL\.md|LICENSE|THIRD_PARTY_NOTICES\.md|CHANGELOG\.md|Makefile|scripts\/|docs\/|tests\/|lib\/)/;
    const extra = isDashboard
      ? /^(package(?:-lock)?\.json|src\/|public\/|config\/dashboard\.example\.json)$/
      : /^(VERSION|version\.txt|base\/|templates\/|extensions\/|flavors\/)/;
    const files = git("ls-tree", "-rz", "--full-tree", "HEAD")
      .split("\0")
      .filter(Boolean)
      .map((row) => {
        const [meta, name] = row.split("\t");
        return { mode: meta.split(" ")[0], name };
      })
      .filter(
        ({ name }) =>
          common.test(name) || extra.test(name) || (isDashboard && /^(src|public)\//.test(name)),
      );
    if (files.some(({ mode }) => !["100644", "100755"].includes(mode)))
      throw new Error("Release contains unsupported links or submodules");
    // These are never distributable, even if accidentally tracked beneath an allowed root.
    if (
      files.some(({ name }) =>
        /(^|\/)(\.env[^/]*|privacy-settings\.json|operators\.json|dashboard\.json|local\.json)$|\.(?:pem|key|sqlite|log)$/.test(
          name,
        ),
      )
    )
      throw new Error("Runtime/private file in release scope; remove it before staging");
    fs.mkdirSync(destination, { mode: 0o700 });
    for (const { mode, name } of files) {
      const target = path.join(destination, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(
        target,
        execFileSync("git", ["show", `HEAD:${name}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 }),
        { mode: mode === "100755" ? 0o755 : 0o644 },
      );
    }
    console.log(
      JSON.stringify({
        version,
        commit: git("rev-parse", "HEAD").trim(),
        stagedFiles: files.length,
        destination,
      }),
    );
  } else
    console.log(
      `Version metadata and changelog match ${version}. No files, refs or registry records changed.`,
    );
}
try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
