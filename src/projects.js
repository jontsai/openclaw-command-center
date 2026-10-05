/** Provider-independent, read-only project snapshots. Never executes adapter code. */
const fs = require("node:fs");
const path = require("node:path");
const { redactExtensionText } = require("./extension-redaction");

const LIMITS = Object.freeze({
  selectionBytes: 16384,
  snapshotBytes: 1048576,
  sources: 8,
  projects: 200,
  links: 20,
});
const STALE_MS = 5 * 60 * 1000;
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const STAGES = new Set(["inbox", "planned", "doing", "review", "done", "canceled", "unknown"]);
const HEALTH = new Set(["on-track", "at-risk", "blocked", "off-track", "unknown"]);
const STATUSES = new Set(["ready", "partial", "error", "unavailable"]);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = () => {
  throw new Error("invalid");
};
function string(value, max, required = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim()) ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    })
  )
    invalid();
  return value;
}
function id(value) {
  if (typeof value !== "string" || !ID.test(value)) invalid();
  return value;
}
function identifier(value) {
  string(value, 128, true);
  // Identifiers cannot be redacted without breaking cross-source associations.
  if (redactExtensionText(value) !== value) invalid();
  return value;
}
function display(value, max = 256, required = false) {
  return redactExtensionText(string(value, max, required));
}
function list(value, max) {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value;
}
function timestamp(value) {
  string(value, 40, true);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    invalid();
  date(value.slice(0, 10));
  return value;
}
function date(value) {
  if (value === null || value === undefined) return null;
  string(value, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    invalid();
  return value;
}
function count(value) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}
function safeUrl(value) {
  if (value === null || value === undefined) return null;
  string(value, 2048, true);
  let url;
  try {
    url = new URL(value);
  } catch {
    invalid();
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    /\s/.test(value) ||
    redactExtensionText(value) !== value
  )
    invalid();
  // Links are navigation only: the host never fetches them.
  return url.href;
}
function validateProject(project) {
  if (
    !record(project) ||
    !["project", "epic", "milestone"].includes(project.kind) ||
    !STAGES.has(project.stage) ||
    !HEALTH.has(project.health)
  )
    invalid();
  const counts = project.counts === undefined ? {} : project.counts;
  if (!record(counts)) invalid();
  const normalizedCounts = {
    total: count(counts.total),
    done: count(counts.done),
    blocked: count(counts.blocked),
  };
  if (
    normalizedCounts.total !== null &&
    [normalizedCounts.done, normalizedCounts.blocked].some(
      (v) => v !== null && v > normalizedCounts.total,
    )
  )
    invalid();
  return {
    id: identifier(project.id),
    title: display(project.title, 256, true),
    url: safeUrl(project.url),
    kind: project.kind,
    stage: project.stage,
    nativeStatus: display(project.nativeStatus),
    nativeStatusId:
      project.nativeStatusId === undefined || project.nativeStatusId === null
        ? null
        : identifier(project.nativeStatusId),
    health: project.health,
    owner: project.owner === undefined || project.owner === null ? null : display(project.owner),
    summary: display(project.summary === undefined ? "" : project.summary, 2048),
    updatedAt:
      project.updatedAt === undefined || project.updatedAt === null
        ? null
        : timestamp(project.updatedAt),
    targetDate: date(project.targetDate),
    counts: normalizedCounts,
    agents: list(project.agents === undefined ? [] : project.agents, LIMITS.links).map((v) =>
      display(v, 256, true),
    ),
    sessionKeys: list(
      project.sessionKeys === undefined ? [] : project.sessionKeys,
      LIMITS.links,
    ).map((v) => display(v, 512, true)),
    dependencies: list(
      project.dependencies === undefined ? [] : project.dependencies,
      LIMITS.links,
    ).map((dependency) => {
      if (!record(dependency)) invalid();
      return { sourceId: id(dependency.sourceId), projectId: identifier(dependency.projectId) };
    }),
  };
}

/** Validate/copy only public display fields, bound to the selected dashboard/source. */
function validateProjectSnapshot(
  snapshot,
  { sourceId, provider, profile = "", agentId = "main", now = Date.now } = {},
) {
  if (
    !record(snapshot) ||
    snapshot.schemaVersion !== 1 ||
    snapshot.sourceId !== sourceId ||
    snapshot.provider !== provider ||
    snapshot.profile !== profile ||
    snapshot.agentId !== agentId ||
    !STATUSES.has(snapshot.status)
  )
    invalid();
  const observedAt = timestamp(snapshot.observedAt);
  if (Date.parse(observedAt) > now() + 60000) invalid();
  const projects = list(snapshot.projects, LIMITS.projects).map(validateProject);
  if (new Set(projects.map((p) => p.id)).size !== projects.length) invalid();
  return {
    status: snapshot.status,
    observedAt,
    // Failed imports may carry validated last-known data with its original time.
    // The host exposes these only as stale, never as successful fresh data.
    projects,
  };
}

/** Bounded nonblocking regular-file reads, refusing symlinks at every component. */
async function readBoundedJson(workspace, relative, maxBytes) {
  const root = await fs.promises.realpath(workspace);
  const parts = relative.split("/");
  let filename = root;
  let expected;
  for (let i = 0; i < parts.length; i++) {
    filename = path.join(filename, parts[i]);
    const stat = await fs.promises.lstat(filename);
    if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()))
      invalid();
    expected = stat;
  }
  if (expected.size > maxBytes || (await fs.promises.realpath(filename)) !== filename) invalid();
  const handle = await fs.promises.open(
    filename,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.size > maxBytes ||
      stat.ino !== expected.ino ||
      stat.dev !== expected.dev ||
      (await fs.promises.realpath(filename)) !== filename
    )
      invalid();
    const buffer = Buffer.alloc(maxBytes + 1);
    let bytes = 0;
    while (bytes <= maxBytes) {
      const read = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
    }
    if (bytes > maxBytes || (await fs.promises.realpath(filename)) !== filename) invalid();
    return JSON.parse(buffer.subarray(0, bytes).toString("utf8"));
  } finally {
    await handle.close();
  }
}

function portfolioStatus(sources) {
  const active = sources.filter((source) => source.status !== "disabled");
  if (!active.length) return "unavailable";
  if (active.every((source) => source.status === "ready")) return "ready";
  if (active.some((source) => ["ready", "partial", "stale"].includes(source.status)))
    return "partial";
  return active.some((source) => source.status === "error") ? "error" : "unavailable";
}

/** Cached synchronous reads, asynchronous per-file bounded/coalesced refresh. */
function createProjectHost({
  workspace,
  profile = "",
  agentId = "main",
  now = Date.now,
  readJson = readBoundedJson,
  timeoutMs = 1000,
  refreshMs = 5000,
}) {
  let cached = { schemaVersion: 1, status: "unavailable", sources: [], diagnostic: "loading" };
  let lastRefresh = -Infinity;
  let inFlight;
  const reads = new Map();
  const lastValid = new Map();
  const selectionPath = "state/command-center/project-sources.json";
  const failed = (diagnostic, status = "error") => ({
    schemaVersion: 1,
    status,
    sources: [],
    diagnostic,
  });

  async function boundedRead(relative, cap) {
    let operation = reads.get(relative);
    if (!operation) {
      if (relative !== selectionPath && reads.size >= LIMITS.sources) throw new Error("read_limit");
      operation = Promise.resolve().then(() => readJson(workspace, relative, cap));
      reads.set(relative, operation);
      operation.then(
        () => reads.delete(relative),
        () => reads.delete(relative),
      );
    }
    let timer;
    try {
      return await Promise.race([
        operation,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error("timeout");
            error.code = "ETIMEDOUT";
            reject(error);
          }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function load() {
    let selection;
    try {
      selection = await boundedRead(selectionPath, LIMITS.selectionBytes);
    } catch (error) {
      lastValid.clear();
      return failed(
        error.code === "ENOENT" ? "selection_unavailable" : "selection_invalid",
        error.code === "ENOENT" ? "unavailable" : "error",
      );
    }
    let entries;
    try {
      if (
        !record(selection) ||
        selection.schemaVersion !== 1 ||
        selection.profile !== profile ||
        selection.agentId !== agentId
      )
        invalid();
      entries = list(selection.sources, LIMITS.sources).map((entry) => {
        if (!record(entry) || typeof entry.enabled !== "boolean") invalid();
        return {
          id: id(entry.id),
          provider: id(entry.provider),
          label: display(entry.label, 256, true),
          enabled: entry.enabled,
        };
      });
      if (new Set(entries.map((entry) => entry.id)).size !== entries.length) invalid();
    } catch {
      lastValid.clear();
      return failed("selection_invalid");
    }
    const selected = new Set(
      entries
        .filter((entry) => entry.enabled)
        .map((entry) => JSON.stringify([entry.id, entry.provider])),
    );
    for (const key of lastValid.keys()) if (!selected.has(key)) lastValid.delete(key);
    const sources = await Promise.all(
      entries.map(async (entry) => {
        const base = { id: entry.id, provider: entry.provider, label: entry.label };
        const key = JSON.stringify([entry.id, entry.provider]);
        if (!entry.enabled) return { ...base, status: "disabled", observedAt: null, projects: [] };
        const failure = (status, diagnostic, observedAt = null) => {
          const previous = lastValid.get(key);
          return previous
            ? { ...base, ...previous, status: "stale", diagnostic }
            : { ...base, status, observedAt, projects: [], diagnostic };
        };
        try {
          const input = await boundedRead(
            `state/command-center/projects/${entry.id}.json`,
            LIMITS.snapshotBytes,
          );
          const result = validateProjectSnapshot(input, {
            sourceId: entry.id,
            provider: entry.provider,
            profile,
            agentId,
            now,
          });
          const previous = lastValid.get(key);
          if (["error", "unavailable"].includes(result.status)) {
            if (
              result.projects.length &&
              (!previous || Date.parse(result.observedAt) >= Date.parse(previous.observedAt))
            ) {
              lastValid.set(key, result);
            }
            return failure(result.status, `source_${result.status}`, result.observedAt);
          }
          if (previous && Date.parse(result.observedAt) < Date.parse(previous.observedAt))
            return failure("error", "snapshot_older");
          lastValid.set(key, result);
          return {
            ...base,
            ...result,
            status: now() - Date.parse(result.observedAt) > STALE_MS ? "stale" : result.status,
          };
        } catch (error) {
          return failure(
            error.code === "ENOENT" ? "unavailable" : "error",
            error.code === "ENOENT"
              ? "snapshot_unavailable"
              : error.code === "ETIMEDOUT"
                ? "snapshot_timeout"
                : "snapshot_invalid",
          );
        }
      }),
    );
    return { schemaVersion: 1, status: portfolioStatus(sources), sources };
  }

  function refresh() {
    if (inFlight) return inFlight;
    lastRefresh = now();
    inFlight = load()
      .then(
        (result) => {
          cached = result;
          return getCached();
        },
        () => {
          cached = failed("refresh_failed");
          return cached;
        },
      )
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }
  function getCached() {
    const sources = cached.sources.map((source) =>
      ["ready", "partial"].includes(source.status) &&
      now() - Date.parse(source.observedAt) > STALE_MS
        ? { ...source, status: "stale" }
        : source,
    );
    if (sources.some((source, i) => source !== cached.sources[i]))
      cached = { ...cached, sources, status: portfolioStatus(sources) };
    return cached;
  }
  function getState() {
    if (now() - lastRefresh >= refreshMs) void refresh();
    return getCached();
  }
  return { getState, refresh };
}
module.exports = { createProjectHost, validateProjectSnapshot, LIMITS, STALE_MS };
