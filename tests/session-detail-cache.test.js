const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSessionsModule } = require("../src/sessions");
test("details reuse catalog, coalesce modern history, preserve whole-session totals", async () => {
  const key = "agent:main:example";
  let listCalls = 0,
    historyCalls = 0,
    release;
  const sessions = createSessionsModule({
    getOpenClawDir: () => "/missing-synthetic",
    getOperatorBySlackId: () => null,
    extractJSON: (x) => x,
    runOpenClaw: () => {
      throw Error("Synchronous CLI is forbidden");
    },
    runOpenClawAsync: (args) => {
      if (typeof args === "string") {
        listCalls++;
        return JSON.stringify({
          sessions: [
            {
              key,
              sessionId: "example",
              totalTokens: 1000,
              inputTokens: 800,
              outputTokens: 200,
              ageMs: 100,
            },
          ],
        });
      }
      historyCalls++;
      return new Promise((r) => {
        release = r;
      });
    },
  });
  await Promise.all([sessions.refreshSessionsCache(), sessions.refreshSessionsCache()]);
  assert.equal(listCalls, 1);
  const first = sessions.getSessionDetailAsync(key),
    second = sessions.getSessionDetailAsync(key);
  assert.equal(historyCalls, 1);
  release(
    JSON.stringify({
      sessionKey: key,
      messages: [
        { role: "user", content: "Example question?", timestamp: 1 },
        {
          role: "assistant",
          content: "Example response",
          usage: { input: 10, output: 5, cost: { total: 2 } },
        },
      ],
    }),
  );
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b);
  assert.equal(a.tokens, 1000);
  assert.equal(a.estCost, null);
  assert.equal(a.transcriptAvailable, true);
  assert.equal(a.messages.length, 2);
  assert.match(a.summary, /recent/);
  await sessions.getSessionDetailAsync(key);
  assert.equal(historyCalls, 1);
  assert.equal(listCalls, 1);
});
test("cold catalog returns promptly while a single asynchronous load runs", async () => {
  let release,
    calls = 0;
  const sessions = createSessionsModule({
    getOpenClawDir: () => "/missing-synthetic",
    getOperatorBySlackId: () => null,
    extractJSON: (x) => x,
    runOpenClaw: () => {
      throw Error("sync");
    },
    runOpenClawAsync: () => {
      calls++;
      return new Promise((r) => {
        release = r;
      });
    },
  });
  assert.match((await sessions.getSessionDetailAsync("x")).error, /loading/);
  await sessions.getSessionDetailAsync("x");
  assert.equal(calls, 1);
  release('{"sessions":[]}');
  await sessions.refreshSessionsCache();
});
