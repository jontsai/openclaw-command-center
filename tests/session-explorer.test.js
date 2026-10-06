const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("../public/js/session-explorer-model");
const sample = (overrides = {}) => ({
  sessionKey: "agent:pilot:slack:channel:example-room",
  label: "#sample-room thread",
  channel: "slack",
  channelId: "example-room",
  channelName: "#sample-room",
  channelAccount: "demo",
  sessionType: "channel",
  minutesAgo: 10,
  active: true,
  tokens: 20,
  ...overrides,
});
test("channel groups use identity, not equal names; account and provider isolated", () => {
  const rows = [
    sample(),
    sample({ sessionKey: "second-thread" }),
    sample({ channelAccount: "other" }),
    sample({ channel: "discord" }),
    sample({ channelId: "different-room" }),
  ].map(M.normalize);
  assert.deepEqual(
    M.groups(rows, "channel").map((g) => g.items.length),
    [2, 1, 1, 1],
  );
  rows[1].channelName = "#renamed";
  assert.equal(M.groups(rows, "channel").length, 4);
});
test("missing identities never join by a shared fallback name", () => {
  const rows = [
    sample({ sessionKey: "one", channelId: null }),
    sample({ sessionKey: "two", channelId: null }),
  ].map(M.normalize);
  assert.equal(M.groups(rows, "channel").length, 2);
});
test("privacy excludes hidden sessions before grouping; missing privacy fails closed", () => {
  const rows = [sample(), sample({ sessionKey: "agent:other:main" })];
  assert.equal(
    M.visible(rows, { hiddenSessions: [{ id: rows[0].sessionKey.toUpperCase() }] }).length,
    1,
  );
  assert.throws(() => M.visible(rows, null));
});
test("filters combine and literal search can find a session beyond the first page", () => {
  const rows = Array.from({ length: 40 }, (_, i) =>
    sample({ sessionKey: `agent:pilot:run:${i}`, label: `Task [${i}]` }),
  ).map(M.normalize);
  assert.equal(
    M.select(rows, { query: "[39]", agent: "pilot", platform: "slack", status: "live" }).length,
    1,
  );
  assert.equal(M.select(rows, { query: "[39]", status: "idle" }).length, 0);
  assert.equal(M.select(rows, { query: ".*" }).length, 0);
});
test("unknown age and tokens are preserved and sorted after known zero", () => {
  const unknown = M.normalize(sample({ minutesAgo: null, active: false, tokens: null }));
  const zero = M.normalize(sample({ sessionKey: "zero", minutesAgo: 0, tokens: 0 }));
  assert.equal(unknown.age, null);
  assert.equal(unknown.tokens, null);
  assert.equal(unknown.status, "unknown");
  assert.equal(M.select([unknown, zero])[0].id, "zero");
  assert.equal(M.select([unknown, zero], {}, "tokens")[0].id, "zero");
});
test("raw keys are not primary labels and grouping does not invent dependencies", () => {
  const s = M.normalize({
    sessionKey: "agent:pilot:subagent:example",
    label: "agent:pilot:subagent:example",
  });
  assert.equal(s.label, "");
  assert.equal(s.agent, "pilot");
  assert.equal(s.kind, "unknown");
  assert.equal(M.groups([s], "none")[0].key, "all");
});

test("unknown agent filter remains selectable and activity windows are exclusive", () => {
  const unknown = M.normalize({ sessionKey: "opaque", minutesAgo: null });
  assert.equal(M.select([unknown], { agent: "unknown" }).length, 1);
  const windows = [0, 60, 1440, 10080].map((minutesAgo) => M.normalize({ minutesAgo }));
  assert.deepEqual(
    windows.map((s) => s.activity),
    ["hour", "day", "week", "older"],
  );
});
