/** Generic read-only work graph. Providers and inference policies live in adapters. */
const { readBoundedJson } = require("./projects");
const { redactExtensionText } = require("./extension-redaction");
const KINDS = new Set(["outcome", "task", "run", "agent", "role", "topic"]);
const STATES = new Set([
  "planned",
  "doing",
  "review",
  "done",
  "canceled",
  "unknown",
  "active",
  "waiting",
  "finished",
]);
const RELATIONS = {
  contains: [["outcome", "task"], ["task"]],
  "works-on": [["task"], ["run"]],
  runs: [["agent"], ["run"]],
  role: [["task", "run"], ["role"]],
  topic: [["task"], ["topic"]],
  blocks: [["task"], ["task"]],
};
const bad = () => {
  throw new Error("invalid");
};
const list = (x, n) => {
  if (!Array.isArray(x) || x.length > n) bad();
  return x;
};
function string(x, n = 256) {
  // Reject control characters from untrusted snapshot text.
  // eslint-disable-next-line no-control-regex
  if (typeof x !== "string" || x.length > n || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(x)) bad();
  return redactExtensionText(x);
}
function id(x) {
  const s = string(x, 2048);
  if (!s || s !== x) bad();
  return s;
}
function date(x, now) {
  string(x, 40);
  if (
    !/^\d{4}-\d\d-\d\dT/.test(x) ||
    !Number.isFinite(Date.parse(x)) ||
    new Date(x).toISOString().slice(0, 10) !== x.slice(0, 10) ||
    Date.parse(x) > now + 60000
  )
    bad();
  return x;
}
function validateWorkGraph(graph, { profile = "", agentId = "main", now = Date.now() } = {}) {
  if (!graph || graph.schemaVersion !== 1 || graph.profile !== profile || graph.agentId !== agentId)
    bad();
  const observedAt = date(graph.observedAt, now);
  const sources = list(graph.sources, 8).map((s) => ({
    id: id(s.id),
    provider: string(s.provider, 32),
    observedAt: date(s.observedAt, now),
    complete: s.complete === true,
  }));
  const sourceIds = new Set(sources.map((s) => s.id));
  if (sourceIds.size !== sources.length) bad();
  const nodes = list(graph.nodes, 2000).map((n) => {
    if (
      !KINDS.has(n.kind) ||
      !STATES.has(n.state) ||
      (!sourceIds.has(n.sourceId) && !["agent", "role"].includes(n.kind))
    )
      bad();
    return {
      id: id(n.id),
      sourceId: id(n.sourceId),
      kind: n.kind,
      title: string(n.title),
      state: n.state,
      nativeStatus: string(n.nativeStatus || ""),
      observedAt: date(n.observedAt, now),
      nativeId: n.nativeId ? id(n.nativeId) : null,
      identifier: n.identifier ? string(n.identifier) : null,
      sessionKey: n.sessionKey ? id(n.sessionKey) : null,
      agent: n.agent ? id(n.agent) : null,
    };
  });
  const index = new Map(nodes.map((n) => [n.id, n]));
  if (index.size !== nodes.length) bad();
  const unique = new Set();
  const edges = list(graph.edges, 5000).map((e) => {
    const from = index.get(e.from),
      to = index.get(e.to),
      types = RELATIONS[e.relation];
    if (
      !from ||
      !to ||
      e.from === e.to ||
      !types ||
      !types[0].includes(from.kind) ||
      !types[1].includes(to.kind) ||
      !["observed", "inferred"].includes(e.basis)
    )
      bad();
    if (
      ["contains", "works-on", "blocks", "topic"].includes(e.relation) &&
      from.sourceId !== to.sourceId
    )
      bad();
    if (["contains", "blocks", "runs"].includes(e.relation) && e.basis !== "observed") bad();
    const k = JSON.stringify([e.from, e.to, e.relation, e.basis]);
    if (unique.has(k)) bad();
    unique.add(k);
    return {
      from: e.from,
      to: e.to,
      relation: e.relation,
      basis: e.basis,
      evidence: string(e.evidence, 512),
    };
  });
  const children = new Map();
  for (const e of edges)
    if (e.relation === "contains") {
      if (!children.has(e.from)) children.set(e.from, []);
      children.get(e.from).push(e.to);
    }
  const visited = new Set(),
    stack = new Set();
  function visit(k) {
    if (stack.has(k)) bad();
    if (visited.has(k)) return;
    stack.add(k);
    for (const child of children.get(k) || []) visit(child);
    stack.delete(k);
    visited.add(k);
  }
  for (const k of index.keys()) visit(k);
  const stale = sources.some((s) => now - Date.parse(s.observedAt) > 300000);
  return {
    schemaVersion: 1,
    profile,
    agentId,
    observedAt,
    status: stale
      ? "stale"
      : sources.some((s) => !s.complete) || (graph.warnings || []).length
        ? "partial"
        : "ready",
    sources,
    nodes,
    edges,
    warnings: list(graph.warnings || [], 20).map((x) => string(x, 64)),
  };
}
function createWorkGraphHost({
  workspace,
  profile = "",
  agentId = "main",
  readJson = readBoundedJson,
  now = Date.now,
}) {
  let pending = null,
    cached = { status: "unavailable", nodes: [], edges: [], sources: [] },
    last = -Infinity;
  async function load() {
    try {
      cached = validateWorkGraph(
        await readJson(workspace, "state/command-center/work-graph.json", 2097152),
        { profile, agentId, now: now() },
      );
    } catch {
      cached = { status: "unavailable", nodes: [], edges: [], sources: [] };
    }
    return cached;
  }
  function refresh() {
    if (pending) return pending;
    if (now() - last < 1000) return Promise.resolve(cached);
    last = now();
    pending = load().finally(() => {
      pending = null;
    });
    return pending;
  }
  return { refresh };
}
module.exports = { validateWorkGraph, createWorkGraphHost };
