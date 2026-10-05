const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { validateKnowledge, createKnowledgeHost } = require("../src/knowledge");
const doc = {
  id: "topic-1",
  parentId: null,
  kind: "topic",
  title: "Reliability",
  excerpt: "# Sources matter",
  sourceRef: "topics/reliability/topic.md",
  updatedAt: "2026-01-01T00:00:00Z",
  truncated: false,
  url: null,
};
function snapshot() {
  return {
    schemaVersion: 1,
    profile: "",
    agentId: "main",
    sources: [
      {
        id: "cerebro",
        label: "Topics",
        adapter: "cerebro",
        observedAt: "2026-01-01T00:00:00Z",
        indexUpdatedAt: "2025-12-01T00:00:00Z",
        status: "ready",
        documents: [JSON.parse(JSON.stringify(doc))],
      },
    ],
  };
}
test("validated snapshot distinguishes collection and index freshness, strips unrecognized data", () => {
  const input = snapshot();
  input.privateField = "do not forward";
  const out = validateKnowledge(input);
  assert.equal(out.privateField, undefined);
  assert.equal(out.sources[0].stale, true);
  assert.notEqual(out.sources[0].observedAt, out.sources[0].indexUpdatedAt);
});
test("foreign identity, duplicate sources and oversized source list are refused", () => {
  assert.throws(() => validateKnowledge(snapshot(), { profile: "other" }));
  const input = snapshot();
  input.sources.push(input.sources[0]);
  assert.throws(() => validateKnowledge(input));
  input.sources = Array(9).fill(input.sources[0]);
  assert.throws(() => validateKnowledge(input));
});
test("cycles, missing parents, bad links and excess excerpts isolate one source", () => {
  for (const override of [
    { parentId: "topic-1" },
    { parentId: "missing" },
    { url: "javascript:alert(1)" },
    { excerpt: "x".repeat(12001) },
  ]) {
    const input = snapshot();
    Object.assign(input.sources[0].documents[0], override);
    input.sources.push({ ...snapshot().sources[0], id: "healthy" });
    const out = validateKnowledge(input);
    assert.equal(out.sources[0].status, "error");
    assert.equal(out.sources[1].status, "ready");
  }
});
test("requests coalesce and cache without adding monitoring refresh work", async () => {
  let reads = 0;
  const host = createKnowledgeHost({
    workspace: "/unused",
    read: async () => {
      reads++;
      return snapshot();
    },
  });
  await Promise.all([host.refresh(), host.refresh(), host.refresh()]);
  await host.refresh();
  assert.equal(reads, 1);
});
test("missing, malformed, symlink and FIFO snapshots do not expose files or block", async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const host = () => createKnowledgeHost({ workspace: root }).refresh();
  assert.equal((await host()).status, "unavailable");
  const base = path.join(root, "state/command-center");
  fs.mkdirSync(base, { recursive: true });
  const file = path.join(base, "knowledge.json");
  fs.writeFileSync(file, "bad");
  assert.equal((await host()).status, "error");
  fs.unlinkSync(file);
  fs.symlinkSync(path.join(root, "other"), file);
  assert.equal((await host()).status, "error");
  fs.unlinkSync(file);
  execFileSync("mkfifo", [file]);
  assert.equal((await host()).status, "error");
});
test("source content is redacted rather than rendered as HTML", () => {
  const input = snapshot();
  input.sources[0].documents[0].excerpt =
    "<script>unsafe()</script> Authorization: Bearer synthetic-secret-token";
  const out = validateKnowledge(input);
  assert.equal(out.sources[0].documents[0].excerpt.includes("synthetic-secret-token"), false);
  assert.equal(out.sources[0].documents[0].excerpt.includes("<script>"), true); // renderer uses textContent
});
