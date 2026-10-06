const test = require("node:test");
const assert = require("node:assert/strict");
const { validateWorkGraph, createWorkGraphHost } = require("../src/work-graph");
const { view } = require("../public/js/operations-model");
const fixture = require("./fixtures/work-graph.json");
const fresh = () => JSON.parse(JSON.stringify(fixture));
const now = Date.parse(fixture.observedAt);
test("source scope and incomplete coverage survive normalization", () => {
  const g = validateWorkGraph(fresh(), { now });
  assert.equal(g.status, "partial");
  assert.equal(g.nodes.filter((n) => n.nativeId === "1").length, 2);
  assert.throws(() => validateWorkGraph(fresh(), { now, profile: "other" }));
});
test("freshness is based on source observations, not page load", () => {
  assert.equal(validateWorkGraph(fresh(), { now: now + 300001 }).status, "stale");
  const g = fresh();
  g.sources[0].observedAt = "2027-01-01T00:00:00Z";
  assert.throws(() => validateWorkGraph(g, { now }));
});
test("graph rejects cross-source bindings, dangling edges, cycles and duplicate nodes", () => {
  const g = fresh();
  g.edges.push({
    from: "demo-linear:task:1",
    to: "demo-jira:run:run-3",
    relation: "works-on",
    basis: "observed",
    evidence: "test",
  });
  assert.throws(() => validateWorkGraph(g, { now }));
  for (const mutate of [
    (g) => g.nodes.push(g.nodes[0]),
    (g) =>
      g.edges.push({
        from: "absent",
        to: g.nodes[0].id,
        relation: "contains",
        basis: "observed",
        evidence: "test",
      }),
    (g) => {
      for (const [a, b] of [
        ["1", "2"],
        ["2", "1"],
      ])
        g.edges.push({
          from: `demo-linear:task:${a}`,
          to: `demo-linear:task:${b}`,
          relation: "contains",
          basis: "observed",
          evidence: "test",
        });
    },
  ]) {
    const graph = fresh();
    mutate(graph);
    assert.throws(() => validateWorkGraph(graph, { now }));
  }
});
test("role proposals and reference mentions do not become assignments by default", () => {
  const g = validateWorkGraph(fresh(), { now });
  const v = view(g);
  assert.equal(v.unlinkedRuns.length, 1);
  assert.equal(v.groups[0].runs.length, 3);
  const preview = view(g, { includeInferred: true });
  assert.equal(preview.unlinkedRuns.length, 0);
  assert.equal(preview.groups[0].runs.length, 4);
  assert.equal(
    view(g, { lens: "role" }).groups.find((g) => g.seed.title === "backend").tasks.length,
    1,
  );
});
test("individual agent view does not absorb peer runs on the same task", () => {
  const g = fresh();
  g.edges.push({
    from: "demo-linear:task:1",
    to: "demo-linear:run:run-1",
    relation: "works-on",
    basis: "observed",
    evidence: "shared task",
  });
  const v = view(g, { lens: "agent" });
  const builder = v.groups.find((g) => g.seed.title === "Builder");
  assert.equal(builder.runs.length, 1);
  assert.equal(builder.runs[0].agent, "Builder");
});
test("hidden sessions disappear from nodes, evidence, counts and orphan agents", () => {
  const v = view(fresh(), {
    lens: "agent",
    hiddenSessions: [{ id: "agent:demo:run:unlinked" }],
    includeInferred: true,
  });
  assert.ok(!v.index.has("demo-linear:run:unlinked"));
  assert.ok(!v.groups.some((g) => g.seed.title === "Architect"));
  assert.equal(v.inferredCount, 1);
});
test("unknown tracker states remain unknown and progress counts are distinct", () => {
  const v = view(fresh());
  const jira = v.groups.find((g) => g.seed.title === "Service rollout");
  assert.equal(jira.unknown, 1);
  assert.equal(jira.blockers.length, 1);
  assert.equal(jira.done, 0);
  assert.equal(v.groups[0].done, 1);
  assert.equal(v.groups[0].tasks.length, 3);
});
test("host coalesces reads and fails closed without exposing reader errors", async () => {
  let calls = 0,
    resolve;
  const host = createWorkGraphHost({
    workspace: ".",
    now: () => now,
    readJson: () => {
      calls++;
      return new Promise((r) => (resolve = r));
    },
  });
  const a = host.refresh(),
    b = host.refresh();
  assert.equal(calls, 1);
  resolve(fresh());
  assert.equal((await a).status, "partial");
  assert.deepEqual(await b, await a);
  const failed = createWorkGraphHost({
    workspace: ".",
    readJson: async () => {
      throw new Error("private-data");
    },
  });
  assert.deepEqual(await failed.refresh(), {
    status: "unavailable",
    nodes: [],
    edges: [],
    sources: [],
  });
});
test("host rejects a snapshot behind a symlink", async () => {
  const fs = require("node:fs"),
    os = require("node:os"),
    path = require("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "work-graph-test-"));
  try {
    fs.mkdirSync(path.join(root, "state/command-center"), { recursive: true });
    fs.writeFileSync(path.join(root, "graph.json"), JSON.stringify(fresh()));
    fs.symlinkSync(
      path.join(root, "graph.json"),
      path.join(root, "state/command-center/work-graph.json"),
    );
    assert.equal(
      (await createWorkGraphHost({ workspace: root, now: () => now }).refresh()).status,
      "unavailable",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("untrusted display strings are redacted and unbounded graphs rejected", () => {
  const g = fresh();
  g.nodes[0].title = "password" + "=synthetic-value";
  g.edges[0].evidence = "Bearer " + "z".repeat(24);
  const clean = validateWorkGraph(g, { now });
  assert.match(clean.nodes[0].title, /REDACTED/);
  assert.match(clean.edges[0].evidence, /REDACTED/);
  const huge = fresh();
  huge.nodes = Array(2001).fill(huge.nodes[0]);
  assert.throws(() => validateWorkGraph(huge, { now }));
});
