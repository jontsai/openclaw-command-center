const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createExtensionHost, LIMITS, STALE_MS } = require("../src/extensions");
const { createStateModule } = require("../src/state");

const label = { en: "Signal", "zh-CN": "信号" };
const selection = (changes = {}) => ({
  schemaVersion: 1,
  profile: "",
  agentId: "main",
  mode: "extensions",
  enabled: [{ id: "spacesuit.intel", version: "1.0.0" }],
  ...changes,
});
const snapshot = (changes = {}) => ({
  schemaVersion: 1,
  id: "spacesuit.intel",
  version: "1.0.0",
  profile: "",
  agentId: "main",
  observedAt: new Date().toISOString(),
  status: "ready",
  panels: [{ id: "summary", type: "metrics", title: label, metrics: [{ label, value: 0 }] }],
  ...changes,
});
function fixture(t) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cc-extension-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const directory = path.join(workspace, "state/command-center");
  fs.mkdirSync(path.join(directory, "extensions"), { recursive: true });
  const writeSelection = (data) =>
    fs.writeFileSync(path.join(directory, "extensions.json"), JSON.stringify(data));
  const writeSnapshot = (data, id = "spacesuit.intel") =>
    fs.writeFileSync(path.join(directory, "extensions", `${id}.json`), JSON.stringify(data));
  return { workspace, directory, writeSelection, writeSnapshot };
}

test("core and legacy overrides never touch extension files; invalid mode fails closed", async () => {
  for (const mode of ["core", "legacy", "typo"]) {
    const host = createExtensionHost({
      workspace: "/unused",
      mode,
      readJson: () => {
        throw new Error("must not read");
      },
    });
    assert.equal((await host.refresh()).mode, mode === "legacy" ? "legacy" : "core");
    assert.deepEqual(host.getState().items, []);
    if (mode === "typo") assert.equal(host.getState().diagnostic, "invalid_mode");
  }
});

test("absent selection preserves legacy, explicit extensions missing selection fails closed", async (t) => {
  const { workspace } = fixture(t);
  assert.equal((await createExtensionHost({ workspace, mode: "" }).refresh()).mode, "legacy");
  const result = await createExtensionHost({ workspace, mode: "extensions" }).refresh();
  assert.equal(result.mode, "core");
  assert.equal(result.diagnostic, "selection_unavailable");
});

test("selected snapshots retain real zero, bilingual labels and safe display-only fields", async (t) => {
  const f = fixture(t);
  f.writeSelection(selection());
  f.writeSnapshot(snapshot({ secrets: "must not publish" }));
  const host = createExtensionHost({ workspace: f.workspace, mode: "" });
  assert.equal(host.getState().mode, "core");
  const state = await host.refresh();
  assert.equal(state.mode, "extensions");
  assert.equal(state.items[0].status, "ready");
  assert.equal(state.items[0].panels[0].metrics[0].value, 0);
  assert.equal(state.items[0].panels[0].title["zh-CN"], "信号");
  assert.ok(!JSON.stringify(state).includes("must not publish"));
  assert.equal(host.getState(), state);
});

test("selection rejects identity, schema, duplicate IDs, invalid versions and traversal", async (t) => {
  const f = fixture(t);
  for (const change of [
    { schemaVersion: 2 },
    { profile: "other" },
    { agentId: "other" },
    { mode: "unknown" },
    { enabled: [{ id: "../../private", version: "1.0.0" }] },
    { enabled: [{ id: "spacesuit.intel", version: "*" }] },
    { enabled: [selection().enabled[0], selection().enabled[0]] },
    {
      enabled: Array.from({ length: LIMITS.extensions + 1 }, (_, i) => ({
        id: `spacesuit.item${i}`,
        version: "1.0.0",
      })),
    },
  ]) {
    f.writeSelection(selection(change));
    const result = await createExtensionHost({ workspace: f.workspace, mode: "" }).refresh();
    assert.equal(result.mode, "core", JSON.stringify(change));
    assert.equal(result.diagnostic, "selection_invalid");
  }
});

test("two host instances never share profile or agent snapshots", async (t) => {
  const f = fixture(t);
  f.writeSelection(selection({ profile: "work", agentId: "worker" }));
  f.writeSnapshot(snapshot({ profile: "work", agentId: "worker" }));
  const matching = createExtensionHost({
    workspace: f.workspace,
    mode: "",
    profile: "work",
    agentId: "worker",
  });
  const other = createExtensionHost({
    workspace: f.workspace,
    mode: "",
    profile: "personal",
    agentId: "worker",
  });
  assert.equal((await matching.refresh()).items[0].status, "ready");
  assert.equal((await other.refresh()).mode, "core");
  f.writeSelection(selection());
  assert.equal((await matching.refresh()).mode, "core");
  assert.deepEqual(matching.getState().items, []);
});

test("bad snapshots are isolated; errors never publish numeric zero or raw exceptions", async (t) => {
  const f = fixture(t);
  f.writeSelection(
    selection({
      enabled: [
        ...selection().enabled,
        { id: "spacesuit.pipeline", version: "1.0.0" },
        { id: "spacesuit.monetization", version: "1.0.0" },
      ],
    }),
  );
  f.writeSnapshot(snapshot());
  fs.writeFileSync(
    path.join(f.directory, "extensions/spacesuit.pipeline.json"),
    "secret /private/raw-path invalid JSON",
  );
  const result = await createExtensionHost({ workspace: f.workspace, mode: "" }).refresh();
  assert.deepEqual(
    result.items.map((i) => i.status),
    ["ready", "error", "unavailable"],
  );
  assert.deepEqual(result.items[1].panels, []);
  assert.ok(!JSON.stringify(result).includes("secret"));
});

test("snapshot schema, exact version, identity, timestamps and locale integrity are validated", async (t) => {
  const f = fixture(t);
  f.writeSelection(selection());
  const badPanels = [
    { id: "summary", type: "metrics", title: { en: "English only" }, metrics: [] },
  ];
  for (const change of [
    { schemaVersion: 2 },
    { id: "spacesuit.pipeline" },
    { version: "1.0.1" },
    { profile: "other" },
    { agentId: "other" },
    { observedAt: "yesterday" },
    { observedAt: new Date(Date.now() + 120000).toISOString() },
    { status: "unknown" },
    { panels: badPanels },
    { panels: [{ ...snapshot().panels[0], type: "html" }] },
    { panels: Array.from({ length: LIMITS.panels + 1 }, () => snapshot().panels[0]) },
    {
      panels: [
        { ...snapshot().panels[0], metrics: [{ label, value: "x".repeat(LIMITS.text + 1) }] },
      ],
    },
  ]) {
    f.writeSnapshot(snapshot(change));
    const result = await createExtensionHost({ workspace: f.workspace, mode: "" }).refresh();
    assert.equal(result.items[0].status, "error", JSON.stringify(change));
    assert.deepEqual(result.items[0].panels, []);
  }
});

test("host derives staleness from observed time and drops unavailable/error panels", async (t) => {
  const f = fixture(t);
  let now = Date.now();
  f.writeSelection(selection());
  f.writeSnapshot(snapshot({ observedAt: new Date(now).toISOString() }));
  const host = createExtensionHost({
    workspace: f.workspace,
    mode: "",
    now: () => now,
    refreshMs: Infinity,
  });
  await host.refresh();
  now += STALE_MS + 1;
  assert.equal(host.getState().items[0].status, "stale");
  for (const status of ["error", "unavailable"]) {
    f.writeSnapshot(snapshot({ status }));
    const result = await host.refresh();
    assert.equal(result.items[0].status, status);
    assert.deepEqual(result.items[0].panels, []);
  }
});

test("tables permit text/numbers/null only, strip extra fields and reject prototype keys", async (t) => {
  const f = fixture(t);
  f.writeSelection(selection());
  const table = {
    id: "rows",
    type: "table",
    title: label,
    columns: [{ key: "name", label }],
    rows: [{ name: '<img onerror="bad">', secret: "hidden" }, { name: null }, { name: 1 }],
  };
  f.writeSnapshot(snapshot({ panels: [table] }));
  const host = createExtensionHost({ workspace: f.workspace, mode: "" });
  const result = await host.refresh();
  assert.deepEqual(result.items[0].panels[0].rows, [
    { name: '<img onerror="bad">' },
    { name: null },
    { name: 1 },
  ]);
  for (const columns of [
    [{ key: "__proto__", label }],
    [
      { key: "name", label },
      { key: "name", label },
    ],
  ]) {
    f.writeSnapshot(snapshot({ panels: [{ ...table, columns }] }));
    assert.equal((await host.refresh()).items[0].status, "error");
  }
});

test("oversized files, symlinks, directories and ancestor symlinks cannot be read", async (t) => {
  const f = fixture(t);
  f.writeSelection(selection());
  const file = path.join(f.directory, "extensions/spacesuit.intel.json");
  fs.writeFileSync(file, " ".repeat(LIMITS.snapshotBytes + 1));
  const host = createExtensionHost({ workspace: f.workspace, mode: "" });
  assert.equal((await host.refresh()).items[0].status, "error");
  fs.unlinkSync(file);
  fs.symlinkSync(path.join(f.directory, "extensions.json"), file);
  assert.equal((await host.refresh()).items[0].status, "error");
  fs.unlinkSync(file);
  fs.mkdirSync(file);
  assert.equal((await host.refresh()).items[0].status, "error");
  fs.rmSync(file, { recursive: true });
  fs.renameSync(path.join(f.directory, "extensions"), path.join(f.directory, "elsewhere"));
  fs.symlinkSync(path.join(f.directory, "elsewhere"), path.join(f.directory, "extensions"));
  assert.equal((await host.refresh()).items[0].status, "error");
  fs.writeFileSync(
    path.join(f.directory, "extensions.json"),
    " ".repeat(LIMITS.selectionBytes + 1),
  );
  assert.equal((await host.refresh()).diagnostic, "selection_invalid");
});

test("nonblocking cache coalesces refresh and bounds hung reads without accumulating requests", async () => {
  let calls = 0;
  let finish;
  const readJson = () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const host = createExtensionHost({
    workspace: "/unused",
    mode: "",
    readJson,
    timeoutMs: 15,
    refreshMs: 0,
  });
  const initial = host.getState();
  assert.equal(initial.diagnostic, "loading");
  const first = host.refresh();
  assert.equal(host.refresh(), first);
  const result = await first;
  assert.equal(result.diagnostic, "refresh_timeout");
  for (let i = 0; i < 20; i++) host.getState();
  assert.equal(calls, 1);
  finish(selection({ mode: "core", enabled: [] }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result.mode, "core");
});

function stateFixture(t, getExtensions) {
  const f = fixture(t);
  let reads = 0;
  let sessionsReads = 0;
  const state = createStateModule({
    CONFIG: {
      paths: { workspace: f.workspace, memory: path.join(f.workspace, "memory") },
      billing: {},
    },
    getOpenClawDir: () => f.workspace,
    getSessions: () => {
      sessionsReads++;
      return [{ sessionKey: "agent:main:slack:chat", active: true, minutesAgo: 0 }];
    },
    getSystemVitals: () => ({ cpu: 1 }),
    getCronJobs: () => [],
    loadOperators: () => ({}),
    calculateOperatorStats: () => ({}),
    getLlmUsage: () => ({}),
    getDailyTokenUsage: () => ({}),
    getTokenStats: () => ({}),
    getCerebroTopics: () => ({}),
    runOpenClaw: () => "",
    extractJSON: () => null,
    readTranscript: () => [],
    getIntelStats: () => {
      reads++;
      return { count: 1 };
    },
    getPipelineStats: () => {
      reads++;
      return { count: 2 };
    },
    getMonetizationStats: () => {
      reads++;
      return { count: 3 };
    },
    getExtensions,
  });
  return { state, reads: () => reads, sessionsReads: () => sessionsReads };
}

test("core/extensions mode never invokes legacy domain collectors and retains monitoring", (t) => {
  for (const mode of ["core", "extensions"]) {
    const extensionState = { schemaVersion: 1, mode, items: [] };
    const f = stateFixture(t, () => extensionState);
    const result = f.state.getFullState();
    assert.equal(f.reads(), 0);
    assert.equal(result.sessions.length, 1);
    assert.equal(result.vitals.cpu, 1);
    assert.ok(!("intel" in result));
    assert.equal(result.extensions, extensionState);
  }
});

test("legacy migration default retains collectors; mode switches remove old panels immediately", (t) => {
  let extensions = { schemaVersion: 1, mode: "legacy", items: [] };
  const f = stateFixture(t, () => extensions);
  assert.deepEqual(f.state.getFullState().intel, { count: 1 });
  assert.equal(f.reads(), 3);
  extensions = { schemaVersion: 1, mode: "core", items: [], diagnostic: "selection_invalid" };
  assert.ok(!("intel" in f.state.getFullState()));
  assert.equal(f.reads(), 3);
  const before = f.sessionsReads();
  extensions = { ...extensions, diagnostic: "refresh_timeout" };
  assert.equal(f.state.getFullState().extensions.diagnostic, "refresh_timeout");
  assert.equal(
    f.sessionsReads(),
    before,
    "extension-only cache updates must not rerun core collectors",
  );
});

test("one stalled snapshot does not block healthy items or accumulate stalled reads", async () => {
  let stalledReads = 0;
  let healthyReads = 0;
  const host = createExtensionHost({
    workspace: "/unused",
    mode: "",
    timeoutMs: 10,
    readJson: async (_workspace, relative) => {
      if (relative.endsWith("extensions.json"))
        return selection({
          enabled: [...selection().enabled, { id: "spacesuit.pipeline", version: "1.0.0" }],
        });
      if (relative.endsWith("spacesuit.intel.json")) {
        healthyReads++;
        return snapshot();
      }
      stalledReads++;
      return new Promise(() => {});
    },
  });
  for (let i = 0; i < 3; i++) {
    const result = await host.refresh();
    assert.equal(result.mode, "extensions");
    assert.deepEqual(
      result.items.map((item) => item.status),
      ["ready", "error"],
    );
    assert.equal(result.items[1].diagnostic, "snapshot_timeout");
    assert.deepEqual(result.items[1].panels, []);
  }
  assert.equal(stalledReads, 1);
  assert.equal(healthyReads, 3);
});

test("snapshot publishing redacts credential-like text in every display surface", async (t) => {
  const f = fixture(t);
  const fake = "synthetic".repeat(5);
  const secretLabel = { en: "api_key=" + fake, "zh-CN": "Bearer " + fake };
  f.writeSelection(selection());
  f.writeSnapshot(
    snapshot({
      panels: [
        {
          id: "metrics",
          type: "metrics",
          title: secretLabel,
          metrics: [{ label: secretLabel, value: "ghp_" + fake }],
        },
        {
          id: "table",
          type: "table",
          title: secretLabel,
          columns: [{ key: "name", label: secretLabel }],
          rows: [{ name: ["password", JSON.stringify(fake)].join("=") }],
        },
      ],
    }),
  );
  const result = await createExtensionHost({ workspace: f.workspace, mode: "" }).refresh();
  assert.equal(result.items[0].status, "ready");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(fake));
  assert.match(JSON.stringify(result), /REDACTED/);
});
