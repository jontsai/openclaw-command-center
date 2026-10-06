const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("../public/js/operations-atlas-model");
const graph = require("./fixtures/work-graph.json");
const empty = { nodes: [], edges: [], sources: [] };
const privacy = { hiddenSessions: [] };
const session = (key, extra = {}) => ({
  sessionKey: key,
  label: "Demo work",
  channel: "slack",
  channelId: "synthetic-channel",
  channelName: "#sample",
  channelAccount: "one",
  minutesAgo: 0,
  lifetimeTokens: 0,
  ...extra,
});
test("native sessions appear without trackers, preserve unknown metrics and exact zero", () => {
  const items = M.build(
    [session("agent:demo:run:a"), session("agent:demo:run:b", { lifetimeTokens: null })],
    empty,
    privacy,
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].tokens, 0);
  assert.equal(items[1].tokens, null);
  for (const lens of ["outcome", "role", "topic"])
    assert.equal(M.groups(items, lens)[0].id, "unassigned");
});
test("equal names across accounts do not merge channel stacks", () => {
  const items = M.build(
    [session("agent:demo:run:a"), session("agent:demo:run:b", { channelAccount: "two" })],
    empty,
    privacy,
  );
  assert.equal(M.groups(items, "channel").length, 2);
});
test("privacy fails closed, hides case-insensitively and deduplicates identities", () => {
  assert.throws(() => M.build([], empty, {}));
  const a = session("agent:demo:run:a");
  assert.equal(M.build([a, a], empty, privacy).length, 1);
  assert.equal(
    M.build([a], empty, { hiddenSessions: [{ id: a.sessionKey.toUpperCase() }] }).length,
    0,
  );
});
test("graph enrichment uses exact keys; observed and inferred links stay opt-in", () => {
  const runs = graph.nodes.filter((n) => n.kind === "run").map((n) => session(n.sessionKey));
  const observed = M.build(runs, graph, privacy),
    inferred = M.build(runs, graph, privacy, true);
  assert.equal(
    observed.find((s) => s.key.endsWith(":unlinked")).facets.outcome[0].id,
    "unassigned",
  );
  assert.notEqual(
    inferred.find((s) => s.key.endsWith(":unlinked")).facets.outcome[0].id,
    "unassigned",
  );
  const stranger = M.build(
    [session("agent:elsewhere:run:other", { label: graph.nodes[0].title })],
    graph,
    privacy,
  );
  assert.equal(stranger[0].facets.outcome[0].id, "unassigned");
});
test("drill-down constraints compose with regrouping, search and activity", () => {
  const items = M.build(
    [
      session("agent:first:run:a", { active: true }),
      session("agent:second:run:b", { active: true }),
      session("agent:first:run:c", { active: false }),
    ],
    empty,
    privacy,
  );
  const group = M.groups(items, "channel")[0];
  const trail = [
    { lens: "channel", id: group.id },
    { lens: "agent", id: "first" },
  ];
  assert.equal(M.select(items, { trail, status: "live" }).length, 1);
  assert.equal(M.select(items, { trail, query: "missing" }).length, 0);
});
test("all sessions remain reachable above the rendering batch limit", () => {
  const items = M.build(
    Array.from({ length: 501 }, (_, i) => session("agent:demo:run:" + i)),
    empty,
    privacy,
  );
  assert.equal(M.groups(items, "channel")[0].items.length, 501);
  assert.equal(M.select(items).length, 501);
});

test("session mapping keeps missing accounting unknown and zero-age sessions active", () => {
  const { createSessionsModule } = require("../src/sessions");
  const sessions = createSessionsModule({
    getOpenClawDir: () => "/unused",
    getOperatorBySlackId: () => null,
    runOpenClaw: () => null,
    runOpenClawAsync: async () => null,
    extractJSON: () => null,
  });
  const mapped = sessions.mapSession({ key: "agent:demo:run:new", ageMs: 0 });
  assert.equal(mapped.active, true);
  assert.equal(mapped.minutesAgo, 0);
  assert.equal(mapped.lifetimeTokens, null);
  assert.equal(
    sessions.mapSession({ key: "agent:demo:run:zero", ageMs: 0, totalTokens: 0 }).lifetimeTokens,
    0,
  );
  assert.equal(sessions.getCatalogStatus().status, "loading");
});
