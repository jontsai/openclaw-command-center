const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createStateModule } = require("../src/state");

function createModule(overrides = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "state-test-"));
  fs.writeFileSync(
    path.join(tmpDir, "openclaw.json"),
    JSON.stringify({ agents: { defaults: { maxConcurrent: 12, subagents: { maxConcurrent: 24 } } } }),
  );

  return createStateModule({
    CONFIG: { paths: { memory: path.join(tmpDir, "memory") }, billing: {} },
    getOpenClawDir: () => tmpDir,
    getSessions: () => [],
    getSystemVitals: () => ({}),
    getCronJobs: () => [],
    loadOperators: () => ({ operators: [] }),
    calculateOperatorStats: () => ({ operators: [], roles: {} }),
    getLlmUsage: () => ({}),
    getDailyTokenUsage: () => ({}),
    getTokenStats: () => ({}),
    getCerebroTopics: () => ({}),
    runOpenClaw: () => {
      throw new Error("runOpenClaw should not be called");
    },
    extractJSON: () => null,
    readTranscript: () => [],
    ...overrides,
  });
}

test("getCapacity uses preloaded sessions without invoking OpenClaw CLI", () => {
  const state = createModule();

  const capacity = state.getCapacity([
    { sessionKey: "agent:main:slack:C123", minutesAgo: 1 },
    { sessionKey: "agent:main:cron:heartbeat", minutesAgo: 2 },
    { sessionKey: "agent:main:subagent:abc", minutesAgo: 4 },
    { sessionKey: "agent:main:slack:old", minutesAgo: 10 },
  ]);

  assert.deepEqual(capacity, {
    main: { active: 1, max: 12 },
    subagent: { active: 2, max: 24 },
  });
});

test("getCapacity still supports raw OpenClaw session objects when preloaded", () => {
  const state = createModule();

  const capacity = state.getCapacity([
    { key: "agent:main:telegram:chat", ageMs: 1000 },
    { key: "agent:main:subagent:worker", ageMs: 2000 },
    { key: "agent:main:cron:job", ageMs: 10 * 60 * 1000 },
  ]);

  assert.deepEqual(capacity, {
    main: { active: 1, max: 12 },
    subagent: { active: 1, max: 24 },
  });
});
