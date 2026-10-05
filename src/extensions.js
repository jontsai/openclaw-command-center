/** Read-only, per-dashboard extension snapshots. Never loads extension code. */
const fs = require("node:fs");
const path = require("node:path");
const { redactExtensionText } = require("./extension-redaction");

const LIMITS = Object.freeze({
  selectionBytes: 16384,
  snapshotBytes: 262144,
  extensions: 8,
  panels: 8,
  metrics: 24,
  columns: 12,
  rows: 100,
  text: 2048,
  label: 256,
});
const ID = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
const KEY = /^[a-z][a-z0-9_-]*$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const MODES = new Set(["core", "legacy", "extensions"]);
const STALE_MS = 5 * 60 * 1000;

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value, max = LIMITS.text) {
  return typeof value === "string" && value.length <= max;
}
function value(value) {
  return text(value) || (typeof value === "number" && Number.isFinite(value));
}
function key(value) {
  return (
    text(value, 64) && KEY.test(value) && !["constructor", "prototype", "__proto__"].includes(value)
  );
}
function localized(label) {
  if (
    !record(label) ||
    !text(label.en, LIMITS.label) ||
    !label.en.trim() ||
    !text(label["zh-CN"], LIMITS.label) ||
    !label["zh-CN"].trim()
  )
    throw new Error("invalid");
  return { en: redactExtensionText(label.en), "zh-CN": redactExtensionText(label["zh-CN"]) };
}
function list(items, max) {
  if (!Array.isArray(items) || items.length > max) throw new Error("invalid");
  return items;
}
function validId(id) {
  return text(id, 100) && ID.test(id);
}
function validVersion(version) {
  return text(version, 32) && VERSION.test(version);
}
function unique(items) {
  return new Set(items).size === items.length;
}

/** Validate and copy only the display fields; unknown input is never published. */
function validatePanels(panels) {
  const result = list(panels, LIMITS.panels).map((panel) => {
    if (!record(panel) || !key(panel.id)) throw new Error("invalid");
    const clean = { id: panel.id, type: panel.type, title: localized(panel.title) };
    if (panel.type === "metrics") {
      clean.metrics = list(panel.metrics, LIMITS.metrics).map((metric) => {
        if (!record(metric) || !value(metric.value)) throw new Error("invalid");
        return {
          label: localized(metric.label),
          value:
            typeof metric.value === "string" ? redactExtensionText(metric.value) : metric.value,
        };
      });
    } else if (panel.type === "table") {
      clean.columns = list(panel.columns, LIMITS.columns).map((column) => {
        if (!record(column) || !key(column.key)) throw new Error("invalid");
        return { key: column.key, label: localized(column.label) };
      });
      if (!clean.columns.length || !unique(clean.columns.map((c) => c.key)))
        throw new Error("invalid");
      clean.rows = list(panel.rows, LIMITS.rows).map((row) => {
        if (!record(row)) throw new Error("invalid");
        const result = {};
        for (const column of clean.columns) {
          const cell = row[column.key];
          if (cell !== null && !value(cell)) throw new Error("invalid");
          result[column.key] = typeof cell === "string" ? redactExtensionText(cell) : cell;
        }
        return result;
      });
    } else throw new Error("invalid");
    return clean;
  });
  if (!unique(result.map((panel) => panel.id))) throw new Error("invalid");
  return result;
}

/** Refuse symlinks and non-regular files, and allocate at most the configured cap. */
async function readBoundedJson(workspace, relative, maxBytes) {
  const root = await fs.promises.realpath(workspace);
  let filename = root;
  const segments = relative.split("/");
  for (let i = 0; i < segments.length; i++) {
    filename = path.join(filename, segments[i]);
    const stat = await fs.promises.lstat(filename);
    if (stat.isSymbolicLink() || (i < segments.length - 1 && !stat.isDirectory())) {
      throw new Error("unsafe");
    }
  }
  // Check the resolved parent again so ancestor symlinks cannot escape the workspace.
  const parent = await fs.promises.realpath(path.dirname(filename));
  if (parent !== path.dirname(filename)) throw new Error("unsafe");
  const handle = await fs.promises.open(
    filename,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error("invalid");
    const buffer = Buffer.alloc(maxBytes + 1);
    let bytes = 0;
    while (bytes <= maxBytes) {
      const read = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
    }
    if (bytes > maxBytes) throw new Error("invalid");
    return JSON.parse(buffer.subarray(0, bytes).toString("utf8"));
  } finally {
    await handle.close();
  }
}

/**
 * Synchronous cached state plus bounded asynchronous refresh. An unresolved file
 * retains its own in-flight lock after timeout: slow disks cannot create a queue
 * of overlapping reads or block healthy extensions. Explicit core/legacy modes perform no extension I/O.
 */
function createExtensionHost({
  workspace,
  profile = "",
  agentId = "main",
  mode = process.env.COMMAND_CENTER_MODE,
  now = Date.now,
  refreshMs = 5000,
  timeoutMs = 1000,
  readJson = readBoundedJson,
}) {
  let cached = { schemaVersion: 1, mode: "core", items: [], diagnostic: "loading" };
  let lastRefresh = -Infinity;
  let inFlight = null;
  const reads = new Map();
  const explicit = mode !== undefined && mode !== "";
  if (explicit && !MODES.has(mode)) {
    cached = { schemaVersion: 1, mode: "core", items: [], diagnostic: "invalid_mode" };
  } else if (mode === "core" || mode === "legacy") {
    cached = { schemaVersion: 1, mode, items: [] };
  }
  const fixed = (explicit && !MODES.has(mode)) || mode === "core" || mode === "legacy";
  const fail = (diagnostic) => ({ schemaVersion: 1, mode: "core", items: [], diagnostic });

  // A timed-out file retains its per-path in-flight read. Healthy files can
  // refresh independently, while the stalled file never accumulates more reads.
  async function boundedRead(relative, cap) {
    let operation = reads.get(relative);
    if (!operation) {
      if (reads.size >= LIMITS.extensions + 1) throw new Error("read_limit");
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
      selection = await boundedRead("state/command-center/extensions.json", LIMITS.selectionBytes);
    } catch (error) {
      if (error.code === "ENOENT" && !explicit)
        return { schemaVersion: 1, mode: "legacy", items: [] };
      return fail(
        error.code === "ENOENT"
          ? "selection_unavailable"
          : error.code === "ETIMEDOUT"
            ? "refresh_timeout"
            : "selection_invalid",
      );
    }
    try {
      if (
        !record(selection) ||
        selection.schemaVersion !== 1 ||
        selection.profile !== profile ||
        selection.agentId !== agentId ||
        !MODES.has(selection.mode)
      )
        throw new Error("invalid");
      list(selection.enabled, LIMITS.extensions);
      if (
        !selection.enabled.every(
          (entry) => record(entry) && validId(entry.id) && validVersion(entry.version),
        ) ||
        !unique(selection.enabled.map((entry) => entry.id))
      )
        throw new Error("invalid");
    } catch {
      return fail("selection_invalid");
    }
    const selectedMode = explicit ? mode : selection.mode;
    if (selectedMode !== "extensions") return { schemaVersion: 1, mode: selectedMode, items: [] };
    const items = await Promise.all(
      selection.enabled.map(async (entry) => {
        const unavailable = (status, diagnostic) => ({
          id: entry.id,
          status,
          observedAt: null,
          panels: [],
          diagnostic,
        });
        let snapshot;
        try {
          snapshot = await boundedRead(
            `state/command-center/extensions/${entry.id}.json`,
            LIMITS.snapshotBytes,
          );
        } catch (error) {
          return unavailable(
            error.code === "ENOENT" ? "unavailable" : "error",
            error.code === "ENOENT"
              ? "snapshot_unavailable"
              : error.code === "ETIMEDOUT"
                ? "snapshot_timeout"
                : "snapshot_invalid",
          );
        }
        try {
          if (
            !record(snapshot) ||
            snapshot.schemaVersion !== 1 ||
            snapshot.id !== entry.id ||
            snapshot.version !== entry.version ||
            snapshot.profile !== profile ||
            snapshot.agentId !== agentId ||
            !["ready", "unavailable", "error"].includes(snapshot.status) ||
            !text(snapshot.observedAt, 40) ||
            !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(snapshot.observedAt)
          )
            throw new Error("invalid");
          const observed = Date.parse(snapshot.observedAt);
          if (!Number.isFinite(observed) || observed > now() + 60000) throw new Error("invalid");
          const panels = validatePanels(snapshot.panels);
          return {
            id: entry.id,
            status:
              snapshot.status === "ready" && now() - observed > STALE_MS
                ? "stale"
                : snapshot.status,
            observedAt: snapshot.observedAt,
            panels: snapshot.status === "ready" ? panels : [],
          };
        } catch {
          return unavailable("error", "snapshot_invalid");
        }
      }),
    );
    return { schemaVersion: 1, mode: "extensions", items };
  }

  function refresh() {
    if (fixed) return Promise.resolve(cached);
    if (inFlight) return inFlight;
    lastRefresh = now();
    inFlight = load()
      .then(
        (result) => {
          cached = result;
          return cached;
        },
        () => {
          cached = fail("refresh_failed");
          return cached;
        },
      )
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  function getState() {
    if (!fixed && now() - lastRefresh >= refreshMs) void refresh();
    if (cached.mode === "extensions") {
      const items = cached.items.map((item) =>
        item.status === "ready" && now() - Date.parse(item.observedAt) > STALE_MS
          ? { ...item, status: "stale" }
          : item,
      );
      if (items.some((item, i) => item !== cached.items[i])) cached = { ...cached, items };
    }
    return cached;
  }
  return { getState, refresh };
}

module.exports = { createExtensionHost, LIMITS, STALE_MS, validatePanels };
