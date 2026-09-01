const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it, beforeEach, afterEach } = require("node:test");
const { createSessionsModule } = require("../src/sessions");

const SESSION_ID = "11111111-2222-3333-4444-555555555555";

function makeModule(openclawDir) {
  return createSessionsModule({
    getOpenClawDir: () => openclawDir,
    getOperatorBySlackId: () => null,
    runOpenClaw: () => "",
    runOpenClawAsync: async () => "",
    extractJSON: () => null,
  });
}

describe("sessions module", () => {
  let tmpDir;
  let sessionsDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "command-center-sessions-"));
    sessionsDir = path.join(tmpDir, "agents", "main", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds topic-suffixed transcripts without requiring an exact transcript file", () => {
    const suffixed = path.join(sessionsDir, `${SESSION_ID}-topic-20260721.jsonl`);
    fs.writeFileSync(suffixed, "{}\n");

    const sessions = makeModule(tmpDir);

    assert.strictEqual(sessions.findTranscriptPath(SESSION_ID), suffixed);
  });

  it("prefers an exact transcript over a suffixed fallback", () => {
    const suffixed = path.join(sessionsDir, `${SESSION_ID}-topic-20260721.jsonl`);
    const exact = path.join(sessionsDir, `${SESSION_ID}.jsonl`);
    fs.writeFileSync(suffixed, "{}\n");
    fs.writeFileSync(exact, "{}\n");

    const sessions = makeModule(tmpDir);

    assert.strictEqual(sessions.findTranscriptPath(SESSION_ID), exact);
  });

  it("notices a newly-created exact transcript without rebuilding the fallback index", () => {
    const suffixed = path.join(sessionsDir, `${SESSION_ID}-topic-20260721.jsonl`);
    const exact = path.join(sessionsDir, `${SESSION_ID}.jsonl`);
    fs.writeFileSync(suffixed, "{}\n");

    const sessions = makeModule(tmpDir);

    assert.strictEqual(sessions.findTranscriptPath(SESSION_ID), suffixed);

    fs.writeFileSync(exact, "{}\n");

    assert.strictEqual(sessions.findTranscriptPath(SESSION_ID), exact);
  });

  it("ignores deleted transcript markers when indexing fallbacks", () => {
    const deleted = path.join(sessionsDir, `${SESSION_ID}-topic-20260721.deleted.jsonl`);
    fs.writeFileSync(deleted, "{}\n");

    const sessions = makeModule(tmpDir);

    assert.strictEqual(sessions.findTranscriptPath(SESSION_ID), null);
  });
});
