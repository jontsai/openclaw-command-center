/**
 * SQLite Data Store — WAL-mode wrapper using the system `sqlite3` binary
 *
 * Zero production dependencies.  Uses child_process.execFileSync to call the
 * sqlite3 CLI that ships with macOS / most Linux distros.
 *
 * Database location: ~/.openclaw/mission-control.db
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { getOpenClawDir } = require("./config");

const DB_NAME = "mission-control.db";

/** Resolve the full path to the database file. */
function getDbPath() {
  return path.join(getOpenClawDir(), DB_NAME);
}

/** Find the sqlite3 binary. */
function findSqlite3() {
  const candidates = ["/usr/bin/sqlite3", "/usr/local/bin/sqlite3"];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // Last resort — hope it's on PATH
  return "sqlite3";
}

const SQLITE3_BIN = findSqlite3();

/**
 * Execute one or more SQL statements and return the output as text.
 *
 * @param {string} sql     — SQL to execute (may contain multiple statements)
 * @param {string} [dbPath] — override the database path (useful for testing)
 * @returns {string} raw stdout from sqlite3
 */
function exec(sql, dbPath) {
  const db = dbPath || getDbPath();
  const dir = path.dirname(db);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return execFileSync(SQLITE3_BIN, [db], {
    input: sql,
    encoding: "utf8",
    timeout: 10000,
  }).trim();
}

/**
 * Execute a query and return rows as an array of objects.
 * Uses .mode json when available; falls back to .mode csv parsing.
 *
 * @param {string} sql     — a single SELECT statement
 * @param {string} [dbPath]
 * @returns {object[]}
 */
function query(sql, dbPath) {
  const preamble = ".mode json\n";
  const raw = exec(preamble + sql, dbPath);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (_e) {
    // Older sqlite3 without .mode json — fall back to line parsing
    return parseLines(sql, dbPath);
  }
}

/**
 * Fallback row parser using .headers on + .mode list (pipe-separated).
 */
function parseLines(sql, dbPath) {
  const preamble = ".headers on\n.mode list\n.separator |\n";
  const raw = exec(preamble + sql, dbPath);
  if (!raw) return [];
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split("|");
  return lines.slice(1).map((line) => {
    const vals = line.split("|");
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = vals[i] === "" ? null : vals[i];
    });
    return obj;
  });
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS zombie_alerts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  salesforce_id   TEXT,
  lead_name       TEXT,
  days_inactive   INTEGER,
  high_risk       INTEGER DEFAULT 0,
  alert_sent_at   INTEGER,
  week_of         TEXT
);

CREATE TABLE IF NOT EXISTS feed_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER,
  type      TEXT,
  severity  TEXT,
  message   TEXT,
  meta      TEXT
);

CREATE TABLE IF NOT EXISTS sync_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at          INTEGER,
  leads_scanned   INTEGER,
  new_zombies     INTEGER,
  high_risk       INTEGER,
  source          TEXT
);
`;

/**
 * Ensure all tables exist.  Safe to call multiple times (CREATE IF NOT EXISTS).
 *
 * @param {string} [dbPath] — override database path (testing)
 */
function ensureSchema(dbPath) {
  exec(SCHEMA_SQL, dbPath);
}

// ─── Convenience helpers ─────────────────────────────────────────────────────

/**
 * Escape a value for safe inclusion in SQL.
 * - null/undefined → 'NULL'
 * - numbers        → as-is
 * - strings        → single-quoted with internal quotes doubled
 */
function esc(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  // Double any single quotes for SQL safety
  return "'" + String(v).replace(/'/g, "''") + "'";
}

/**
 * Insert a zombie alert row.
 *
 * @param {object} alert
 * @param {string} [dbPath]
 */
function insertZombieAlert(alert, dbPath) {
  const sql = `INSERT INTO zombie_alerts (salesforce_id, lead_name, days_inactive, high_risk, alert_sent_at, week_of)
    VALUES (${esc(alert.salesforce_id)}, ${esc(alert.lead_name)}, ${esc(alert.days_inactive)}, ${esc(alert.high_risk ? 1 : 0)}, ${esc(alert.alert_sent_at || Date.now())}, ${esc(alert.week_of || null)});`;
  exec(sql, dbPath);
}

/**
 * Insert a feed event row.
 *
 * @param {object} event
 * @param {string} [dbPath]
 * @returns {void}
 */
function insertFeedEvent(event, dbPath) {
  const meta =
    event.meta !== null && event.meta !== undefined
      ? JSON.stringify(event.meta)
      : null;
  const sql = `INSERT INTO feed_events (ts, type, severity, message, meta)
    VALUES (${esc(event.ts)}, ${esc(event.type)}, ${esc(event.severity)}, ${esc(event.message)}, ${esc(meta)});`;
  exec(sql, dbPath);
}

/**
 * Insert a sync log row.
 *
 * @param {object} log
 * @param {string} [dbPath]
 */
function insertSyncLog(log, dbPath) {
  const sql = `INSERT INTO sync_log (run_at, leads_scanned, new_zombies, high_risk, source)
    VALUES (${esc(log.run_at || Date.now())}, ${esc(log.leads_scanned)}, ${esc(log.new_zombies)}, ${esc(log.high_risk)}, ${esc(log.source || "manual")});`;
  exec(sql, dbPath);
}

/**
 * Query feed events, newest first, with optional limit.
 *
 * @param {object}  [opts]
 * @param {number}  [opts.limit=200]
 * @param {number}  [opts.since=0]   — epoch-ms lower bound
 * @param {string}  [dbPath]
 * @returns {object[]}
 */
function queryFeedEvents(opts = {}, dbPath) {
  const limit = opts.limit || 200;
  const since = opts.since || 0;
  const sql = `SELECT * FROM feed_events WHERE ts > ${esc(since)} ORDER BY ts DESC LIMIT ${limit};`;
  return query(sql, dbPath);
}

/**
 * Query zombie alerts, newest first.
 *
 * @param {object}  [opts]
 * @param {number}  [opts.limit=100]
 * @param {string}  [dbPath]
 * @returns {object[]}
 */
function queryZombieAlerts(opts = {}, dbPath) {
  const limit = opts.limit || 100;
  const sql = `SELECT * FROM zombie_alerts ORDER BY alert_sent_at DESC LIMIT ${limit};`;
  return query(sql, dbPath);
}

/**
 * Query sync log, newest first.
 *
 * @param {object}  [opts]
 * @param {number}  [opts.limit=50]
 * @param {string}  [dbPath]
 * @returns {object[]}
 */
function querySyncLog(opts = {}, dbPath) {
  const limit = opts.limit || 50;
  const sql = `SELECT * FROM sync_log ORDER BY run_at DESC LIMIT ${limit};`;
  return query(sql, dbPath);
}

/**
 * Check if a feed event already exists (by ts + type).  Used for
 * migration deduplication.
 *
 * @param {number} ts
 * @param {string} type
 * @param {string} [dbPath]
 * @returns {boolean}
 */
function feedEventExists(ts, type, dbPath) {
  const sql = `SELECT COUNT(*) as cnt FROM feed_events WHERE ts = ${esc(ts)} AND type = ${esc(type)};`;
  const rows = query(sql, dbPath);
  return rows.length > 0 && parseInt(rows[0].cnt, 10) > 0;
}

module.exports = {
  getDbPath,
  exec,
  query,
  ensureSchema,
  esc,
  insertZombieAlert,
  insertFeedEvent,
  insertSyncLog,
  queryFeedEvents,
  queryZombieAlerts,
  querySyncLog,
  feedEventExists,
  SCHEMA_SQL,
};
