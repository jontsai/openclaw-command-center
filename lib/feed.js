/**
 * Activity Feed — JSONL append-only log
 *
 * Writes to ~/.openclaw/feed.jsonl.
 * Each line: { ts, type, severity, agentId, sessionKey, message, meta }
 *
 * Severity: info | warning | critical
 * Event types: session_start, session_end, cron_run, cron_fail,
 *              cost_spike, agent_error, tool_call
 */

const fs = require("fs");
const path = require("path");
const { getOpenClawDir } = require("./config");

const FEED_FILE = path.join(getOpenClawDir(), "feed.jsonl");
const MAX_READ = 200;

const VALID_SEVERITIES = new Set(["info", "warning", "critical"]);
const VALID_TYPES = new Set([
  "session_start",
  "session_end",
  "cron_run",
  "cron_fail",
  "cost_spike",
  "agent_error",
  "tool_call",
]);

/**
 * Append one entry to the feed log.
 * @param {object} entry
 * @param {string} entry.type - One of VALID_TYPES
 * @param {string} entry.severity - info | warning | critical
 * @param {string} [entry.agentId]
 * @param {string} [entry.sessionKey]
 * @param {string} entry.message
 * @param {object} [entry.meta]
 * @returns {object} The written record (with ts)
 */
function appendEntry(entry) {
  const severity = VALID_SEVERITIES.has(entry.severity) ? entry.severity : "info";
  const type = VALID_TYPES.has(entry.type) ? entry.type : entry.type || "info";

  const record = {
    ts: Date.now(),
    type,
    severity,
    agentId: entry.agentId || null,
    sessionKey: entry.sessionKey || null,
    message: entry.message || "",
    meta: entry.meta || null,
  };

  // Ensure parent directory exists
  const dir = path.dirname(FEED_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.appendFileSync(FEED_FILE, JSON.stringify(record) + "\n", "utf8");
  return record;
}

/**
 * Read feed entries. Returns last `limit` entries, optionally filtered by `since` timestamp.
 * @param {object} [opts]
 * @param {number} [opts.since] - Only return entries after this epoch-ms timestamp
 * @param {number} [opts.limit] - Max entries to return (default MAX_READ)
 * @returns {object[]}
 */
function readEntries(opts = {}) {
  const limit = opts.limit || MAX_READ;
  const since = opts.since || 0;

  if (!fs.existsSync(FEED_FILE)) {
    return [];
  }

  const raw = fs.readFileSync(FEED_FILE, "utf8").trim();
  if (!raw) return [];

  const lines = raw.split("\n");
  const entries = [];

  for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.ts > since) {
        entries.push(entry);
      } else if (since > 0) {
        // Entries are chronological; once we pass the threshold going backwards, stop
        break;
      }
    } catch (_e) {
      // Skip malformed lines
    }
  }

  // Return oldest-first
  return entries.reverse();
}

/**
 * Get the path to the feed file (useful for testing).
 */
function getFeedPath() {
  return FEED_FILE;
}

module.exports = { appendEntry, readEntries, getFeedPath, VALID_TYPES, VALID_SEVERITIES };
