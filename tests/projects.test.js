const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createProjectHost, validateProjectSnapshot, LIMITS, STALE_MS } = require("../src/projects");

const NOW = Date.parse("2026-01-01T12:00:00Z");
const selectionPath = "state/command-center/project-sources.json";
const entry = (id = "linear-main", provider = "linear") => ({
  id,
  provider,
  label: "Example",
  enabled: true,
});
const selection = (sources = [entry()]) => ({
  schemaVersion: 1,
  profile: "",
  agentId: "main",
  sources,
});
const project = (overrides = {}) => ({
  id: "project-1",
  title: "Delivery outcome",
  url: "https://example.org/projects/1",
  kind: "project",
  stage: "doing",
  nativeStatus: "Active",
  health: "unknown",
  owner: null,
  summary: "",
  updatedAt: null,
  targetDate: null,
  counts: { total: null, done: null, blocked: null },
  agents: [],
  sessionKeys: [],
  dependencies: [],
  ...overrides,
});
const snapshot = (overrides = {}) => ({
  schemaVersion: 1,
  sourceId: "linear-main",
  provider: "linear",
  profile: "",
  agentId: "main",
  observedAt: new Date(NOW).toISOString(),
  status: "ready",
  projects: [project()],
  ...overrides,
});
const expected = { sourceId: "linear-main", provider: "linear", now: () => NOW };
function reader(files) {
  return async (_workspace, relative) => {
    if (!files.has(relative)) {
      const error = new Error("private/path");
      error.code = "ENOENT";
      throw error;
    }
    const value = files.get(relative);
    return typeof value === "function" ? value() : value;
  };
}
function fixture() {
  return new Map([
    [selectionPath, selection()],
    ["state/command-center/projects/linear-main.json", snapshot()],
  ]);
}
function host(files, overrides = {}) {
  return createProjectHost({
    workspace: "/unused",
    now: () => NOW,
    readJson: reader(files),
    timeoutMs: 20,
    ...overrides,
  });
}

test("mixed source projects keep structured identities, native states, and unknown metrics", async () => {
  const files = fixture();
  files.set(selectionPath, selection([entry(), entry("jira-main", "jira")]));
  files.set(
    "state/command-center/projects/jira-main.json",
    snapshot({
      sourceId: "jira-main",
      provider: "jira",
      projects: [project({ kind: "epic", stage: "review", counts: undefined })],
    }),
  );
  const result = await host(files).refresh();
  assert.equal(result.status, "ready");
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0].projects[0].title, result.sources[1].projects[0].title);
  assert.deepEqual(result.sources[1].projects[0].counts, {
    total: null,
    done: null,
    blocked: null,
  });
  assert.equal(result.sources[1].projects[0].stage, "review");
  assert.equal(result.sources[1].projects[0].nativeStatus, "Active");
});

test("missing selection leaves standalone monitoring unavailable, not failed", async () => {
  const result = await host(new Map()).refresh();
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.sources, []);
  assert.equal(JSON.stringify(result).includes("private/path"), false);
});

test("disabled sources do not read snapshots", async () => {
  const files = fixture();
  files.set(selectionPath, selection([{ ...entry(), enabled: false }]));
  files.set("state/command-center/projects/linear-main.json", () => {
    assert.fail("must not read disabled source");
  });
  const result = await host(files).refresh();
  assert.equal(result.status, "unavailable");
  assert.equal(result.sources[0].status, "disabled");
});

test("selection isolation and invalid/path-traversal source ids fail closed", async () => {
  for (const patch of [
    { profile: "other" },
    { agentId: "other" },
    { schemaVersion: 2 },
    { sources: [entry("../escape")] },
    { sources: [entry(), entry()] },
    { sources: Array.from({ length: 9 }, (_, i) => entry(`source-${i}`)) },
  ]) {
    const files = fixture();
    files.set(selectionPath, { ...selection(), ...patch });
    assert.equal((await host(files).refresh()).status, "error");
  }
});

test("invalid snapshots isolate only their source, with no raw exception text", async () => {
  const files = fixture();
  files.set(selectionPath, selection([entry(), entry("jira-main", "jira")]));
  files.set(
    "state/command-center/projects/jira-main.json",
    snapshot({
      sourceId: "jira-main",
      provider: "jira",
      projects: [project({ counts: { total: 2, done: 3 } })],
    }),
  );
  const result = await host(files).refresh();
  assert.equal(result.status, "partial");
  assert.equal(result.sources[0].status, "ready");
  assert.equal(result.sources[1].status, "error");
  assert.deepEqual(result.sources[1].projects, []);
});

test("snapshot source/provider/profile/agent/schema and timestamps are validated", () => {
  for (const patch of [
    { sourceId: "other" },
    { provider: "jira" },
    { profile: "other" },
    { agentId: "other" },
    { schemaVersion: 2 },
    { observedAt: "2026-01-01" },
    { observedAt: "2026-02-30T12:00:00Z" },
    { observedAt: new Date(NOW + 61000).toISOString() },
    { status: "success" },
  ])
    assert.throws(() => validateProjectSnapshot(snapshot(patch), expected));
});

test("project validation rejects unsafe links, bounds, duplicate IDs and impossible counts", () => {
  for (const patch of [
    { url: "javascript:alert(1)" },
    { url: "http://example.org" },
    { url: "https://name:password@example.org" },
    { title: "x".repeat(257) },
    { kind: "issue" },
    { counts: { total: 2, blocked: 3 } },
    { counts: { total: -1 } },
    { counts: { total: 1.5 } },
    { counts: { done: "2" } },
    { stage: "finished" },
    { health: "good" },
    { targetDate: "2026-02-30" },
    { dependencies: [{ sourceId: "../bad", projectId: "p" }] },
    { agents: Array(21).fill("agent") },
  ])
    assert.throws(() =>
      validateProjectSnapshot(snapshot({ projects: [project(patch)] }), expected),
    );
  assert.throws(() =>
    validateProjectSnapshot(snapshot({ projects: [project(), project()] }), expected),
  );
  assert.throws(() =>
    validateProjectSnapshot(
      snapshot({ projects: Array.from({ length: 201 }, (_, i) => project({ id: String(i) })) }),
      expected,
    ),
  );
});

test("empty ready result is distinct from an unavailable source, and zero is not null", () => {
  assert.deepEqual(validateProjectSnapshot(snapshot({ projects: [] }), expected).projects, []);
  const result = validateProjectSnapshot(
    snapshot({ projects: [project({ counts: { total: 0, done: 0, blocked: 0 } })] }),
    expected,
  );
  assert.deepEqual(result.projects[0].counts, { total: 0, done: 0, blocked: 0 });
  assert.equal(result.projects[0].stage, "doing");
});

test("copies display fields only, redacts credential patterns, preserves explicit associations", () => {
  const result = validateProjectSnapshot(
    snapshot({
      hidden: "private",
      projects: [
        project({
          title: "Authorization: Basic c3ludGhldGljOnRlc3Q=",
          secret: "private",
          dependencies: [{ sourceId: "jira-main", projectId: "epic-9", hidden: "private" }],
          agents: ["worker"],
          sessionKeys: ["agent:main:task"],
        }),
      ],
    }),
    expected,
  );
  assert.equal(result.projects[0].title.includes("c3ludGhldGljOnRlc3Q="), false);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.deepEqual(result.projects[0].dependencies, [
    { sourceId: "jira-main", projectId: "epic-9" },
  ]);
  assert.deepEqual(result.projects[0].sessionKeys, ["agent:main:task"]);
});

test("last successful data survives failed/offline snapshots as stale and recovers", async () => {
  const files = fixture();
  const instance = host(files);
  await instance.refresh();
  files.set(
    "state/command-center/projects/linear-main.json",
    snapshot({ status: "error", projects: [] }),
  );
  let result = await instance.refresh();
  assert.equal(result.status, "partial");
  assert.equal(result.sources[0].status, "stale");
  assert.equal(result.sources[0].projects.length, 1);
  files.delete("state/command-center/projects/linear-main.json");
  assert.equal((await instance.refresh()).sources[0].status, "stale");
  files.set("state/command-center/projects/linear-main.json", snapshot({ projects: [] }));
  result = await instance.refresh();
  assert.equal(result.sources[0].status, "ready");
  assert.equal(result.sources[0].projects.length, 0);
});

test("removed/disabled/rebound selection cannot resurrect cached source data", async () => {
  for (const next of selection([]).sources.concat([
    { ...entry(), enabled: false },
    { ...entry(), provider: "jira" },
  ])) {
    const files = fixture();
    const instance = host(files);
    await instance.refresh();
    files.set(selectionPath, selection([next]));
    assert.deepEqual((await instance.refresh()).sources[0].projects, []);
  }
  const files = fixture();
  const instance = host(files);
  await instance.refresh();
  files.set(selectionPath, { ...selection(), profile: "other" });
  assert.deepEqual((await instance.refresh()).sources, []);
});

test("freshness ages without a refresh and old snapshots cannot replace newer data", async () => {
  let now = NOW;
  const files = fixture();
  const instance = host(files, { now: () => now, refreshMs: Infinity });
  await instance.refresh();
  now += STALE_MS + 1;
  assert.equal(instance.getState().sources[0].status, "stale");
  assert.equal(instance.getState().status, "partial");
  files.set(
    "state/command-center/projects/linear-main.json",
    snapshot({ observedAt: new Date(NOW - 1000).toISOString(), projects: [] }),
  );
  assert.equal((await instance.refresh()).sources[0].projects.length, 1);
});

test("refreshes coalesce and a hung source never queues reads or suppresses healthy updates", async () => {
  const files = fixture();
  let stalledReads = 0;
  files.set(selectionPath, selection([entry(), entry("jira-main", "jira")]));
  files.set("state/command-center/projects/jira-main.json", () => {
    stalledReads++;
    return new Promise(() => {});
  });
  const instance = host(files);
  const one = instance.refresh();
  assert.equal(instance.refresh(), one);
  let result = await one;
  assert.equal(result.sources[0].status, "ready");
  assert.equal(result.sources[1].diagnostic, "snapshot_timeout");
  files.set(
    "state/command-center/projects/linear-main.json",
    snapshot({ projects: [project({ title: "Changed" })] }),
  );
  result = await instance.refresh();
  assert.equal(result.sources[0].projects[0].title, "Changed");
  assert.equal(stalledReads, 1);
});

test("real filesystem rejects oversized snapshots, symlink components, and FIFOs promptly", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-projects-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const folder = path.join(root, "state/command-center/projects");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(root, selectionPath), JSON.stringify(selection()));
  const target = path.join(folder, "linear-main.json");
  const instance = createProjectHost({ workspace: root, now: () => NOW, timeoutMs: 100 });
  fs.writeFileSync(target, " ".repeat(LIMITS.snapshotBytes + 1));
  assert.equal((await instance.refresh()).sources[0].status, "error");
  fs.unlinkSync(target);
  const outside = path.join(root, "outside.json");
  fs.writeFileSync(outside, JSON.stringify(snapshot()));
  fs.symlinkSync(outside, target);
  assert.equal((await instance.refresh()).sources[0].status, "error");
  fs.unlinkSync(target);
  if (process.platform !== "win32") {
    execFileSync("mkfifo", [target]);
    assert.equal((await instance.refresh()).sources[0].diagnostic, "snapshot_invalid");
    fs.unlinkSync(target);
  }
  fs.writeFileSync(target, JSON.stringify(snapshot()));
  assert.equal((await instance.refresh()).sources[0].status, "ready");
  fs.renameSync(folder, `${folder}-actual`);
  fs.symlinkSync(`${folder}-actual`, folder, "dir");
  const clean = createProjectHost({ workspace: root, now: () => NOW });
  assert.equal((await clean.refresh()).sources[0].status, "error");
});

test("native state IDs are preserved separately from labels and partial sources stay partial", async () => {
  const files = fixture();
  files.set(
    "state/command-center/projects/linear-main.json",
    snapshot({
      status: "partial",
      projects: [project({ nativeStatusId: "state-123", stage: "unknown" })],
    }),
  );
  const result = await host(files).refresh();
  assert.equal(result.status, "partial");
  assert.equal(result.sources[0].status, "partial");
  assert.equal(result.sources[0].projects[0].nativeStatusId, "state-123");
  assert.equal(result.sources[0].projects[0].stage, "unknown");
  assert.throws(() =>
    validateProjectSnapshot(
      snapshot({ projects: [project({ nativeStatusId: "x".repeat(129) })] }),
      expected,
    ),
  );
});

test("removing sources clears portfolio and retained data before re-enable", async () => {
  const files = fixture();
  const instance = host(files);
  await instance.refresh();
  files.set(selectionPath, selection([]));
  assert.deepEqual((await instance.refresh()).sources, []);
  files.set(selectionPath, selection());
  files.delete("state/command-center/projects/linear-main.json");
  assert.equal((await instance.refresh()).sources[0].status, "unavailable");
});

test("provider timestamps preserve microsecond ISO precision", () => {
  const observedAt = "2026-01-01T12:00:00.123456Z";
  const result = validateProjectSnapshot(
    snapshot({
      observedAt,
      projects: [project({ updatedAt: "2025-12-31T23:00:00.123456789+00:00" })],
    }),
    { ...expected, now: () => NOW + 1000 },
  );
  assert.equal(result.observedAt, observedAt);
  assert.equal(result.projects[0].updatedAt, "2025-12-31T23:00:00.123456789+00:00");
});

test("retained failure snapshots remain visible but stale after host restart", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-projects-retained-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "state/command-center/projects"), { recursive: true });
  fs.writeFileSync(path.join(root, selectionPath), JSON.stringify(selection()));
  const file = path.join(root, "state/command-center/projects/linear-main.json");
  for (const status of ["error", "unavailable"]) {
    const observedAt = new Date(NOW - 1000).toISOString();
    fs.writeFileSync(file, JSON.stringify(snapshot({ status, observedAt })));
    const restarted = createProjectHost({ workspace: root, now: () => NOW });
    const result = await restarted.refresh();
    assert.equal(result.status, "partial");
    assert.equal(result.sources[0].status, "stale");
    assert.equal(result.sources[0].diagnostic, `source_${status}`);
    assert.equal(result.sources[0].observedAt, observedAt);
    assert.equal(result.sources[0].projects.length, 1);
  }
  for (const patch of [
    { profile: "other" },
    { provider: "jira" },
    { projects: [project({ url: "javascript:alert(1)" })] },
    { projects: [project({ counts: { total: 1, done: 2 } })] },
  ]) {
    fs.writeFileSync(file, JSON.stringify(snapshot({ status: "error", ...patch })));
    const result = await createProjectHost({ workspace: root, now: () => NOW }).refresh();
    assert.equal(result.sources[0].status, "error");
    assert.deepEqual(result.sources[0].projects, []);
  }
});

test("older retained failures cannot replace newer cached projects", async () => {
  const files = fixture();
  const instance = host(files);
  await instance.refresh();
  files.set(
    "state/command-center/projects/linear-main.json",
    snapshot({
      status: "error",
      observedAt: new Date(NOW - 1000).toISOString(),
      projects: [project({ title: "Older result" })],
    }),
  );
  const result = await instance.refresh();
  assert.equal(result.sources[0].status, "stale");
  assert.equal(result.sources[0].projects[0].title, "Delivery outcome");
});
