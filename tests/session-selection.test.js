const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it, beforeEach, afterEach } = require("node:test");
const { createSessionsModule } = require("../src/sessions");
const { executeAction } = require("../src/actions");
const { runOpenClaw, runOpenClawAsync, extractJSON } = require("../src/openclaw");

describe("explicit session store selection", () => {
  let root;
  let oldPath;
  let oldProfile;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-session-cli-"));
    oldPath = process.env.PATH;
    oldProfile = process.env.OPENCLAW_PROFILE;
    process.env.PATH = `${root}${path.delimiter}${oldPath}`;
    process.env.OPENCLAW_PROFILE = "fixture";
    // Model the current CLI contract: ambiguous owners fail, unbounded lists
    // must opt out of pagination, and profiles remain distinct from agents.
    const cli = `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] !== '--profile' || args[1] !== 'fixture' ||
    args[2] !== 'sessions' || args[args.indexOf('--agent') + 1] !== 'main') {
  process.stderr.write('Explicit session-store owner required');
  process.exit(1);
}
const count = args[args.indexOf('--limit') + 1] === 'all' ? 101 : 100;
const sessions = Array.from({length: count}, (_,i) => ({
  key: 'agent:main:fixture:' + i, sessionId: 'fixture-' + i,
  ageMs: 1000, totalTokens: i, kind: 'direct', model: 'fixture',
  padding: 'x'.repeat(12000)
}));
process.stdout.write(JSON.stringify({count, sessions}));
`;
    fs.writeFileSync(path.join(root, "openclaw"), cli, { mode: 0o755 });
  });

  afterEach(() => {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    if (oldProfile === undefined) delete process.env.OPENCLAW_PROFILE;
    else process.env.OPENCLAW_PROFILE = oldProfile;
    fs.rmSync(root, { recursive: true, force: true });
  });

  function makeSessions() {
    return createSessionsModule({
      getOpenClawDir: () => root,
      getOperatorBySlackId: () => null,
      runOpenClaw,
      runOpenClawAsync,
      extractJSON,
    });
  }

  it("returns correct totals synchronously without truncating a large catalog", () => {
    const result = makeSessions().getSessions({ limit: 2, returnCount: true });
    assert.equal(result.totalCount, 101);
    assert.equal(result.sessions.length, 2);
    assert.equal(result.sessions[0].sessionKey, "agent:main:fixture:0");
  });

  it("refreshes the asynchronous cache for the selected profile and main agent", async () => {
    const sessions = makeSessions();
    await sessions.refreshSessionsCache();
    const result = sessions.getSessions({ limit: null });
    assert.equal(result.length, 101);
    assert.equal(result[100].sessionKey, "agent:main:fixture:100");
  });

  it("finds session details beyond the CLI's default first page", () => {
    const result = makeSessions().getSessionDetail("agent:main:fixture:100");
    assert.equal(result.error, undefined);
    assert.equal(result.key, "agent:main:fixture:100");
  });

  it("uses the same explicit owner for the session-list action", () => {
    const result = executeAction("sessions-list", { runOpenClaw, extractJSON });
    assert.equal(JSON.parse(result.output).sessions.length, 101);
  });
});
