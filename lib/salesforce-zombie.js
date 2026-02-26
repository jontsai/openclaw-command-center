/**
 * Salesforce "Zombie Risk" Detector
 *
 * Flags leads that have gone stale (no activity in >60 days and no active
 * sequence) as "zombie" risks.  When a zombie is detected it:
 *   1. Posts a critical event to the activity feed (lib/feed.js)
 *   2. The notifier picks it up via the normal POST /api/feed → SSE → notify path
 *
 * Usage:
 *   const { evaluateLeads } = require('./salesforce-zombie');
 *   const results = evaluateLeads(leads);   // pure evaluation
 *   const posted  = postZombieAlerts(leads); // evaluate + post to feed
 */

const { appendEntry, VALID_TYPES } = require("./feed");
const db = require("./db");

const ZOMBIE_THRESHOLD_DAYS = 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Register zombie_risk as a recognised feed event type so other parts of the
// system can reference it.  We mutate the shared Set (exported from feed.js)
// rather than forking the source.
VALID_TYPES.add("zombie_risk");

/**
 * Determine whether a single lead qualifies as a zombie.
 *
 * @param {object} lead
 * @param {string}  lead.lastActivityDate — ISO-8601 date string or epoch-ms
 * @param {boolean} [lead.hasActiveSequence=false]
 * @param {number}  [now] — override "now" for testing (epoch-ms)
 * @returns {boolean}
 */
function isZombie(lead, now) {
  if (!lead || !lead.lastActivityDate) return false;

  const lastActivity =
    typeof lead.lastActivityDate === "number"
      ? lead.lastActivityDate
      : new Date(lead.lastActivityDate).getTime();

  if (Number.isNaN(lastActivity)) return false;

  const effectiveNow = now || Date.now();
  const daysSinceActivity = (effectiveNow - lastActivity) / MS_PER_DAY;

  return daysSinceActivity > ZOMBIE_THRESHOLD_DAYS && !lead.hasActiveSequence;
}

/**
 * Evaluate an array of leads and return those flagged as zombies.
 *
 * @param {object[]} leads
 * @param {number}   [now] — override "now" for testing (epoch-ms)
 * @returns {object[]} — subset of leads that are zombies
 */
function evaluateLeads(leads, now) {
  if (!Array.isArray(leads)) return [];
  return leads.filter((lead) => isZombie(lead, now));
}

/**
 * Evaluate leads and post a critical feed event for each zombie detected.
 * Returns the array of feed records that were written.
 *
 * @param {object[]} leads
 * @param {number}   [now] — override "now" for testing
 * @returns {object[]} — feed records posted
 */
function postZombieAlerts(leads, now) {
  const zombies = evaluateLeads(leads, now);
  const records = [];

  for (const lead of zombies) {
    const name = lead.name || lead.id || "Unknown";
    const effectiveNow = now || Date.now();
    const lastActivity =
      typeof lead.lastActivityDate === "number"
        ? lead.lastActivityDate
        : new Date(lead.lastActivityDate).getTime();
    const daysInactive = Math.floor(
      (effectiveNow - lastActivity) / MS_PER_DAY,
    );

    const record = appendEntry({
      type: "zombie_risk",
      severity: "critical",
      message: `Zombie risk: lead "${name}" has had no activity for >60 days and no active sequence`,
      meta: {
        leadId: lead.id || null,
        leadName: lead.name || null,
        lastActivityDate: lead.lastActivityDate,
        hasActiveSequence: !!lead.hasActiveSequence,
      },
    });
    records.push(record);

    // Persist to SQLite zombie_alerts table
    try {
      db.ensureSchema();
      db.insertZombieAlert({
        salesforce_id: lead.id || null,
        lead_name: lead.name || null,
        days_inactive: daysInactive,
        high_risk: daysInactive >= 80,
        alert_sent_at: record.ts,
        week_of: getWeekOf(record.ts),
      });
    } catch (_e) {
      // SQLite write failure should not break the alert pipeline
    }
  }

  return records;
}

/**
 * Get ISO week string (YYYY-Www) for a given epoch-ms timestamp.
 */
function getWeekOf(ts) {
  const d = new Date(ts);
  const year = d.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const days = Math.floor((d - jan1) / MS_PER_DAY);
  const week = Math.ceil((days + jan1.getDay() + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

module.exports = {
  isZombie,
  evaluateLeads,
  postZombieAlerts,
  ZOMBIE_THRESHOLD_DAYS,
  MS_PER_DAY,
};
