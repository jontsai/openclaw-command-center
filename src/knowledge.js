/** Read-only knowledge snapshots. Provider conventions stay outside the host. */
const fs = require("node:fs");
const path = require("node:path");
const { redactExtensionText: redact } = require("./extension-redaction");
const MAX_BYTES = 2 * 1024 * 1024;
const STALE_MS = 15 * 60 * 1000;
const ID = /^[a-zA-Z0-9._:-]{1,160}$/;
const invalid = () => {
  throw new Error("invalid_knowledge");
};
function str(v, n, required = false) {
  if (typeof v !== "string" || v.length > n || (required && !v.trim())) invalid();
  return redact(v);
}
function id(v) {
  if (typeof v !== "string" || !ID.test(v)) invalid();
  return v;
}
function timestamp(v, now) {
  if (typeof v !== "string" || !Number.isFinite(Date.parse(v)) || Date.parse(v) > now + 60000)
    invalid();
  return new Date(v).toISOString();
}
function safeUrl(v) {
  if (v == null) return null;
  const u = new URL(v);
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) invalid();
  return u.href;
}
function validateKnowledge(value, { profile = "", agentId = "main", now = Date.now() } = {}) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    value.profile !== profile ||
    value.agentId !== agentId ||
    !Array.isArray(value.sources) ||
    value.sources.length > 8
  )
    invalid();
  const seen = new Set();
  const sources = value.sources.map((s) => {
    const sourceId = id(s?.id);
    if (seen.has(sourceId)) invalid();
    seen.add(sourceId);
    try {
      const status = s.status;
      if (!["ready", "partial", "unavailable", "error"].includes(status)) invalid();
      if (!Array.isArray(s.documents) || s.documents.length > 500) invalid();
      const ids = new Set();
      const documents = s.documents.map((d) => {
        const docId = id(d?.id);
        if (ids.has(docId)) invalid();
        ids.add(docId);
        if (!["topic", "document", "folder"].includes(d.kind)) invalid();
        return {
          id: docId,
          parentId: d.parentId == null ? null : id(d.parentId),
          kind: d.kind,
          title: str(d.title, 256, true),
          excerpt: str(d.excerpt, 12000),
          sourceRef: str(d.sourceRef, 512, true),
          updatedAt: d.updatedAt == null ? null : timestamp(d.updatedAt, now),
          truncated: d.truncated === true,
          url: safeUrl(d.url),
        };
      });
      const lookup = new Map(documents.map((d) => [d.id, d]));
      for (const d of documents) {
        const ancestors = new Set([d.id]);
        let parent = d.parentId;
        while (parent !== null) {
          if (!lookup.has(parent) || ancestors.has(parent) || ancestors.size > 20) invalid();
          ancestors.add(parent);
          parent = lookup.get(parent).parentId;
        }
      }
      const observedAt = timestamp(s.observedAt, now);
      return {
        id: sourceId,
        label: str(s.label, 128, true),
        adapter: str(s.adapter, 64, true),
        status,
        observedAt,
        indexUpdatedAt: s.indexUpdatedAt == null ? null : timestamp(s.indexUpdatedAt, now),
        stale: now - Date.parse(observedAt) > STALE_MS,
        documents,
      };
    } catch {
      return {
        id: sourceId,
        label: sourceId,
        adapter: "unknown",
        status: "error",
        observedAt: null,
        indexUpdatedAt: null,
        stale: true,
        documents: [],
      };
    }
  });
  return { schemaVersion: 1, status: "ready", profile, agentId, sources };
}

async function readSnapshot(workspace) {
  const root = path.resolve(workspace);
  if ((await fs.promises.realpath(root)) !== root) invalid();
  const parts = ["state", "command-center", "knowledge.json"];
  let file = root;
  for (let i = 0; i < parts.length; i++) {
    file = path.join(file, parts[i]);
    const st = await fs.promises.lstat(file);
    if (st.isSymbolicLink() || (i < parts.length - 1 ? !st.isDirectory() : !st.isFile())) invalid();
  }
  const handle = await fs.promises.open(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.size > MAX_BYTES) invalid();
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let count = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, count, buffer.length - count, null);
      count += bytesRead;
      if (count > MAX_BYTES) invalid();
      if (!bytesRead) break;
    }
    return JSON.parse(buffer.toString("utf8", 0, count));
  } finally {
    await handle.close();
  }
}

function createKnowledgeHost({
  workspace,
  profile = "",
  agentId = "main",
  read = readSnapshot,
  now = Date.now,
}) {
  let running = null;
  let cached = null;
  let checked = 0;
  let pendingRead = null;
  async function refresh() {
    if (running) return running;
    if (cached && now() - checked < 5000) return cached;
    running = (async () => {
      let timer;
      try {
        if (!pendingRead)
          pendingRead = Promise.resolve()
            .then(() => read(workspace))
            .finally(() => {
              pendingRead = null;
            });
        const value = await Promise.race([
          pendingRead,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("timeout")), 2000);
          }),
        ]);
        cached = validateKnowledge(value, { profile, agentId, now: now() });
      } catch (e) {
        cached = {
          schemaVersion: 1,
          status: e.code === "ENOENT" ? "unavailable" : "error",
          sources: [],
        };
      } finally {
        clearTimeout(timer);
        checked = now();
      }
      return cached;
    })();
    try {
      return await running;
    } finally {
      running = null;
    }
  }
  return { refresh };
}
module.exports = { validateKnowledge, createKnowledgeHost, STALE_MS };
