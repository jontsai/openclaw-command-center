const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createChannelDirectory } = require("../src/channel-directory");
test("directory coalesces reads and isolates accounts", async () => {
  let calls = 0;
  const d = createChannelDirectory({
    run: async (args) => {
      calls++;
      const account = args.includes("--account") ? args.at(-1) : "default";
      return JSON.stringify([{ id: "channel:C123", name: account }]);
    },
  });
  d.lookup("slack", "c123");
  d.lookup("slack", "c123");
  await d.settled();
  assert.equal(calls, 1);
  assert.equal(d.lookup("slack", "C123").name, "default");
  assert.equal(d.lookup("slack", "C123", "second").name, null);
  await d.settled();
  assert.equal(d.lookup("slack", "C123", "second").name, "second");
  assert.equal(d.lookup("slack", "C123").name, "default");
});
test("rename replaces cache; failures retain explicitly stale names; unknown IDs stay unknown", async () => {
  let tick = 1,
    name = "old",
    fail = false;
  const d = createChannelDirectory({
    now: () => tick,
    refreshMs: 10,
    run: async () => {
      if (fail) throw Error();
      return JSON.stringify([{ id: "channel:C123", name }]);
    },
  });
  d.lookup("slack", "C123");
  await d.settled();
  name = "renamed";
  tick += 11;
  d.lookup("slack", "C123");
  await d.settled();
  assert.equal(d.lookup("slack", "C123").name, "renamed");
  fail = true;
  tick += 11;
  d.lookup("slack", "C123");
  await d.settled();
  assert.equal(d.lookup("slack", "C123").status, "stale");
  assert.equal(d.lookup("slack", "C123").name, "renamed");
  assert.equal(d.lookup("slack", "C456").name, null);
});
test("malformed or ambiguous catalogs fail closed", async () => {
  for (const value of [
    {},
    [
      { id: "C123", name: "one" },
      { id: "C123", name: "two" },
    ],
  ]) {
    const d = createChannelDirectory({ run: async () => JSON.stringify(value) });
    d.lookup("slack", "C123");
    await d.settled();
    assert.equal(d.lookup("slack", "C123").name, null);
    assert.equal(d.lookup("slack", "C123").status, "unavailable");
  }
});

test("session display refreshes resolved names without a new session CLI request", async () => {
  const { createSessionsModule } = require("../src/sessions");
  let name = null,
    calls = 0;
  const sessions = createSessionsModule({
    getOpenClawDir: () => "/nonexistent-example",
    getOperatorBySlackId: () => null,
    runOpenClaw: () => "",
    extractJSON: (s) => s,
    runOpenClawAsync: async () => {
      calls++;
      return JSON.stringify({
        sessions: [
          {
            key: "agent:main:slack:channel:C123:thread:1700000000",
            sessionId: "example",
            totalTokens: 1,
          },
        ],
      });
    },
    channelDirectory: { lookup: () => ({ name, status: name ? "available" : "loading" }) },
  });
  await sessions.refreshSessionsCache();
  assert.match(sessions.getSessionsCached()[0].label, /Slack channel/);
  name = "example-team";
  const result = sessions.getSessionsCached()[0];
  assert.match(result.label, /#example-team/);
  assert.equal(result.channelId, "C123");
  assert.equal(calls, 1);
});
