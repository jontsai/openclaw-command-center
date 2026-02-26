#!/usr/bin/env node
/**
 * migrate-jsonl.js — Migrate ~/.openclaw/feed.jsonl → SQLite feed_events table
 *
 * Reads the JSONL file line by line and inserts each event into the
 * feed_events table.  Skips duplicates by checking ts + type.
 *
 * Usage:
 *   node scripts/migrate-jsonl.js            # uses default paths
 *   node scripts/migrate-jsonl.js /path/to.db /path/to/feed.jsonl
 */

const fs = require("fs");
const path = require("path");

// Resolve lib path relative to this script
const libDir = path.join(__dirname, "..", "lib");

// Load config first so getOpenClawDir is available
const { getOpenClawDir } = require(path.join(libDir, "config"));
const db = require(path.join(libDir, "db"));

function migrate(dbPath, jsonlPath) {
  const feedFile =
    jsonlPath || path.join(getOpenClawDir(), "feed.jsonl");
  const targetDb = dbPath || undefined; // undefined = default db path

  // Ensure schema exists
  db.ensureSchema(targetDb);

  if (!fs.existsSync(feedFile)) {
    console.log(`No JSONL file found at ${feedFile} — nothing to migrate.`);
    return { total: 0, inserted: 0, skipped: 0 };
  }

  const raw = fs.readFileSync(feedFile, "utf8").trim();
  if (!raw) {
    console.log("JSONL file is empty — nothing to migrate.");
    return { total: 0, inserted: 0, skipped: 0 };
  }

  const lines = raw.split("\n");
  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const line of lines) {
    if (!line.trim()) continue;

    let entry;
    try {
      entry = JSON.parse(line);
    } catch (_e) {
      errors++;
      continue;
    }

    // Skip duplicates by ts + type
    if (db.feedEventExists(entry.ts, entry.type, targetDb)) {
      skipped++;
      continue;
    }

    db.insertFeedEvent(
      {
        ts: entry.ts,
        type: entry.type || "info",
        severity: entry.severity || "info",
        message: entry.message || "",
        meta: entry.meta || null,
      },
      targetDb,
    );
    inserted++;
  }

  const result = { total: lines.length, inserted, skipped, errors };
  console.log(
    `Migration complete: ${inserted} inserted, ${skipped} skipped, ${errors} errors (${lines.length} total lines)`,
  );
  return result;
}

// Run directly
if (require.main === module) {
  const args = process.argv.slice(2);
  migrate(args[0] || undefined, args[1] || undefined);
}

module.exports = { migrate };
