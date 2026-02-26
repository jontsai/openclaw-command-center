/**
 * Friday Night Zombie Scheduler
 *
 * Fires postZombieAlerts() every Friday at 17:00 local time.
 * Reads Salesforce leads from the API using env vars or falls back to mock data.
 * After each run, logs to SQLite sync_log and sends a Telegram summary.
 *
 * Zero new production dependencies — uses setInterval-based scheduling.
 */

const https = require("https");
const { postZombieAlerts, evaluateLeads, MS_PER_DAY } = require("./salesforce-zombie");
const db = require("./db");
const { notify } = require("./notifier");

// ─── Mock dataset for dev / when Salesforce env vars are absent ──────────────

const MOCK_LEADS = [
  { id: "MOCK-001", name: "Acme Corp", lastActivityDate: new Date(Date.now() - 90 * MS_PER_DAY).toISOString(), hasActiveSequence: false },
  { id: "MOCK-002", name: "GloboChem", lastActivityDate: new Date(Date.now() - 30 * MS_PER_DAY).toISOString(), hasActiveSequence: false },
  { id: "MOCK-003", name: "Initech", lastActivityDate: new Date(Date.now() - 120 * MS_PER_DAY).toISOString(), hasActiveSequence: false },
  { id: "MOCK-004", name: "Weyland-Yutani", lastActivityDate: new Date(Date.now() - 10 * MS_PER_DAY).toISOString(), hasActiveSequence: true },
  { id: "MOCK-005", name: "Umbrella Corp", lastActivityDate: new Date(Date.now() - 85 * MS_PER_DAY).toISOString(), hasActiveSequence: false },
  { id: "MOCK-006", name: "Stark Industries", lastActivityDate: new Date(Date.now() - 5 * MS_PER_DAY).toISOString(), hasActiveSequence: false },
];

// ─── Salesforce API fetcher ──────────────────────────────────────────────────

/**
 * Fetch leads from Salesforce REST API.
 * Requires SALESFORCE_INSTANCE_URL and SALESFORCE_ACCESS_TOKEN env vars.
 *
 * @returns {Promise<object[]>} array of lead objects
 */
function fetchSalesforceLeads() {
  const instanceUrl = process.env.SALESFORCE_INSTANCE_URL;
  const accessToken = process.env.SALESFORCE_ACCESS_TOKEN;

  if (!instanceUrl || !accessToken) {
    return Promise.resolve(null); // Signal to use mock data
  }

  const soql = encodeURIComponent(
    "SELECT Id, Name, LastActivityDate, HasActiveSequence__c FROM Lead WHERE IsConverted = false ORDER BY LastActivityDate ASC LIMIT 500",
  );

  const url = new URL(`/services/data/v59.0/query?q=${soql}`, instanceUrl);

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const data = JSON.parse(body);
              const leads = (data.records || []).map((r) => ({
                id: r.Id,
                name: r.Name,
                lastActivityDate: r.LastActivityDate,
                hasActiveSequence: !!r.HasActiveSequence__c,
              }));
              resolve(leads);
            } catch (e) {
              reject(new Error(`Salesforce JSON parse error: ${e.message}`));
            }
          } else {
            reject(new Error(`Salesforce API ${res.statusCode}: ${body.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ─── Summary formatter ───────────────────────────────────────────────────────

/**
 * Format the Friday zombie report summary.
 *
 * @param {object} stats
 * @param {number} stats.leadsScanned
 * @param {number} stats.newZombies
 * @param {number} stats.highRisk
 * @returns {string}
 */
function formatSummary(stats) {
  return [
    "\uD83E\uDDDF Friday Zombie Report",
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    `Leads scanned:    ${String(stats.leadsScanned).padStart(3)}`,
    `New zombies:       ${String(stats.newZombies).padStart(2)}`,
    `High-risk (80+ d): ${String(stats.highRisk).padStart(2)}`,
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "Full report: http://localhost:3000/dashboard",
  ].join("\n");
}

// ─── Core scan runner ────────────────────────────────────────────────────────

/**
 * Run a single zombie scan. Fetches leads, evaluates, posts alerts,
 * logs to SQLite, and sends Telegram summary.
 *
 * @returns {Promise<object>} scan result stats
 */
async function runZombieScan() {
  let leads;
  let source = "salesforce";

  try {
    leads = await fetchSalesforceLeads();
  } catch (e) {
    console.error("[ZombieScheduler] Salesforce fetch failed:", e.message);
    leads = null;
  }

  if (!leads) {
    leads = MOCK_LEADS;
    source = "mock";
    console.log("[ZombieScheduler] Using mock dataset (Salesforce env vars absent or fetch failed)");
  }

  // Evaluate and post alerts
  const records = postZombieAlerts(leads);
  const zombies = evaluateLeads(leads);
  const highRisk = zombies.filter((z) => {
    const lastAct = typeof z.lastActivityDate === "number"
      ? z.lastActivityDate
      : new Date(z.lastActivityDate).getTime();
    return (Date.now() - lastAct) / MS_PER_DAY >= 80;
  });

  const stats = {
    leadsScanned: leads.length,
    newZombies: zombies.length,
    highRisk: highRisk.length,
  };

  // Log to SQLite
  try {
    db.ensureSchema();
    db.insertSyncLog({
      run_at: Date.now(),
      leads_scanned: stats.leadsScanned,
      new_zombies: stats.newZombies,
      high_risk: stats.highRisk,
      source,
    });
  } catch (e) {
    console.error("[ZombieScheduler] SQLite log failed:", e.message);
  }

  // Send Telegram summary
  const summary = formatSummary(stats);
  try {
    await notify({
      type: "zombie_risk",
      severity: "critical",
      message: summary,
    });
  } catch (e) {
    console.error("[ZombieScheduler] Telegram notify failed:", e.message);
  }

  console.log("[ZombieScheduler] Scan complete:", stats);
  return stats;
}

// ─── Scheduler (setInterval-based cron shim) ─────────────────────────────────

/**
 * Calculate milliseconds until next Friday at 17:00 local time.
 *
 * @param {Date} [from] — override "now" for testing
 * @returns {number} ms until target
 */
function msUntilNextFriday1700(from) {
  const now = from || new Date();
  const target = new Date(now);

  // Friday = day 5
  const currentDay = now.getDay();
  let daysUntilFriday = (5 - currentDay + 7) % 7;

  // If it's already Friday, check if 17:00 has passed
  if (daysUntilFriday === 0) {
    const fridayTarget = new Date(now);
    fridayTarget.setHours(17, 0, 0, 0);
    if (now >= fridayTarget) {
      daysUntilFriday = 7; // Next Friday
    }
  }

  target.setDate(now.getDate() + daysUntilFriday);
  target.setHours(17, 0, 0, 0);

  return target.getTime() - now.getTime();
}

let schedulerTimer = null;

/**
 * Start the Friday 17:00 scheduler. Sets a timeout for the next Friday,
 * then repeats weekly via setInterval.
 */
function startScheduler() {
  const msToNext = msUntilNextFriday1700();
  const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

  console.log(
    `[ZombieScheduler] Next scan in ${Math.round(msToNext / 60000)} minutes (${new Date(Date.now() + msToNext).toLocaleString()})`,
  );

  schedulerTimer = setTimeout(() => {
    runZombieScan();
    // Then repeat every week
    schedulerTimer = setInterval(runZombieScan, ONE_WEEK);
  }, msToNext);
}

/**
 * Stop the scheduler.
 */
function stopScheduler() {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

module.exports = {
  runZombieScan,
  fetchSalesforceLeads,
  formatSummary,
  msUntilNextFriday1700,
  startScheduler,
  stopScheduler,
  MOCK_LEADS,
};
