#!/usr/bin/env node
/**
 * Linear Integration Module for OpenClaw Dashboard
 *
 * Syncs session state to Linear issues:
 * - Extracts JON-XXX issue IDs from session transcripts
 * - Updates Linear issue status when session state changes
 * - Adds comments on state transitions
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const { getOpenClawDir } = require("./config");

// Linear API configuration
const LINEAR_API_URL = "https://api.linear.app/graphql";
const LINEAR_API_KEY = process.env.LINEAR_API_KEY;

// Workflow State IDs for team JON (from TOOLS.md)
const LINEAR_STATES = {
  TODO: "2ee58f08-499b-47ee-bbe3-a254957517c5",
  IN_PROGRESS: "c2c429d8-11d0-4fa5-bbe7-7bc7febbd42e",
  DONE: "b82d1646-6044-48ad-b2e9-04f87739e16f",
};

// Session state to Linear state mapping
const STATE_MAP = {
  active: LINEAR_STATES.IN_PROGRESS,
  live: LINEAR_STATES.IN_PROGRESS,
  idle: LINEAR_STATES.TODO,
  completed: LINEAR_STATES.DONE,
};

// Track synced issues to avoid duplicate updates
// Key: issueId, Value: { lastState, lastUpdated }
const syncState = new Map();

// Path to persist sync state
const SYNC_STATE_FILE = path.join(__dirname, "..", "state", "linear-sync-state.json");

/**
 * Load sync state from disk
 */
function loadSyncState() {
  try {
    if (fs.existsSync(SYNC_STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(SYNC_STATE_FILE, "utf8"));
      Object.entries(data).forEach(([key, value]) => {
        syncState.set(key, value);
      });
      console.log(`[Linear] Loaded sync state: ${syncState.size} issues tracked`);
    }
  } catch (e) {
    console.error("[Linear] Failed to load sync state:", e.message);
  }
}

/**
 * Save sync state to disk
 */
function saveSyncState() {
  try {
    const data = Object.fromEntries(syncState);
    const dir = path.dirname(SYNC_STATE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SYNC_STATE_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("[Linear] Failed to save sync state:", e.message);
  }
}

/**
 * Make a GraphQL request to Linear API
 * @param {string} query - GraphQL query/mutation
 * @param {object} variables - Query variables
 * @returns {Promise<object>} Response data
 */
function linearRequest(query, variables = {}) {
  return new Promise((resolve, reject) => {
    if (!LINEAR_API_KEY) {
      reject(new Error("LINEAR_API_KEY not set"));
      return;
    }

    const payload = JSON.stringify({ query, variables });

    const options = {
      hostname: "api.linear.app",
      port: 443,
      path: "/graphql",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: LINEAR_API_KEY,
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.errors) {
            reject(new Error(parsed.errors[0]?.message || "GraphQL error"));
          } else {
            resolve(parsed.data);
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Extract Linear issue IDs (JON-XXX pattern) from text
 * @param {string} text - Text to search
 * @returns {string[]} Array of unique issue identifiers
 */
function extractLinearIds(text) {
  if (!text) return [];

  // Match JON-XXX pattern (case insensitive, 1-5 digits)
  const pattern = /\bJON-(\d{1,5})\b/gi;
  const matches = text.match(pattern) || [];

  // Normalize to uppercase and dedupe
  const unique = [...new Set(matches.map((m) => m.toUpperCase()))];
  return unique;
}

/**
 * Extract Linear IDs from a session transcript
 * @param {Array} transcript - Array of transcript entries
 * @returns {string[]} Array of unique issue identifiers
 */
function extractLinearIdsFromTranscript(transcript) {
  const allIds = new Set();

  transcript.forEach((entry) => {
    if (entry.type !== "message" || !entry.message) return;

    const msg = entry.message;
    let text = "";

    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter((c) => c.type === "text")
        .map((c) => c.text || "")
        .join(" ");
    }

    extractLinearIds(text).forEach((id) => allIds.add(id));
  });

  return [...allIds];
}

/**
 * Get issue details by identifier (e.g., "JON-29")
 * @param {string} identifier - Issue identifier
 * @returns {Promise<object|null>} Issue data or null
 */
async function getIssue(identifier) {
  const query = `
        query GetIssue($id: String!) {
            issue(id: $id) {
                id
                identifier
                title
                description
                url
                state {
                    id
                    name
                    type
                }
                priority
            }
        }
    `;

  try {
    const data = await linearRequest(query, { id: identifier });
    return data.issue;
  } catch (e) {
    console.error(`[Linear] Failed to get issue ${identifier}:`, e.message);
    return null;
  }
}

/**
 * Update issue state
 * @param {string} issueId - Issue UUID (not identifier)
 * @param {string} stateId - New state UUID
 * @returns {Promise<boolean>} Success status
 */
async function updateIssueState(issueId, stateId) {
  const mutation = `
        mutation UpdateIssueState($id: String!, $stateId: String!) {
            issueUpdate(id: $id, input: { stateId: $stateId }) {
                success
                issue {
                    id
                    identifier
                    state {
                        name
                    }
                }
            }
        }
    `;

  try {
    const data = await linearRequest(mutation, { id: issueId, stateId });
    return data.issueUpdate?.success || false;
  } catch (e) {
    console.error(`[Linear] Failed to update issue state:`, e.message);
    return false;
  }
}

/**
 * Add a comment to an issue
 * @param {string} issueId - Issue UUID (not identifier)
 * @param {string} body - Comment body (markdown supported)
 * @returns {Promise<boolean>} Success status
 */
async function addComment(issueId, body) {
  const mutation = `
        mutation AddComment($issueId: String!, $body: String!) {
            commentCreate(input: { issueId: $issueId, body: $body }) {
                success
                comment {
                    id
                }
            }
        }
    `;

  try {
    const data = await linearRequest(mutation, { issueId, body });
    return data.commentCreate?.success || false;
  } catch (e) {
    console.error(`[Linear] Failed to add comment:`, e.message);
    return false;
  }
}

/**
 * Determine session state from session data
 * @param {object} session - Session object with ageMs, etc.
 * @returns {string} State: 'active', 'idle', or 'completed'
 */
function determineSessionState(session) {
  const ageMs = session.ageMs || 0;
  const thirtyMinutes = 30 * 60 * 1000;

  // Check if session is marked complete (this would come from session metadata)
  if (session.status === "completed" || session.completed) {
    return "completed";
  }

  // Active if activity within 30 minutes
  if (ageMs < thirtyMinutes) {
    return "active";
  }

  // Idle if no activity for 30+ minutes
  return "idle";
}

/**
 * Sync a session's Linear issues based on session state
 * @param {object} session - Session data including transcript
 * @param {Array} transcript - Session transcript entries
 * @returns {Promise<object>} Sync results
 */
async function syncSessionToLinear(session, transcript) {
  const results = {
    issuesFound: [],
    updated: [],
    skipped: [],
    errors: [],
  };

  if (!LINEAR_API_KEY) {
    results.errors.push("LINEAR_API_KEY not configured");
    return results;
  }

  // Extract Linear issue IDs from transcript
  const issueIds = extractLinearIdsFromTranscript(transcript);
  results.issuesFound = issueIds;

  if (issueIds.length === 0) {
    return results;
  }

  // Determine current session state
  const sessionState = determineSessionState(session);
  const targetStateId = STATE_MAP[sessionState];

  if (!targetStateId) {
    results.errors.push(`Unknown session state: ${sessionState}`);
    return results;
  }

  // Process each issue
  for (const identifier of issueIds) {
    try {
      // Check sync state to avoid duplicate updates
      const syncKey = `${identifier}:${session.key || session.sessionId}`;
      const lastSync = syncState.get(syncKey);

      if (lastSync && lastSync.lastState === sessionState) {
        results.skipped.push({
          identifier,
          reason: "Already synced to this state",
        });
        continue;
      }

      // Get issue details
      const issue = await getIssue(identifier);
      if (!issue) {
        results.errors.push(`Issue ${identifier} not found`);
        continue;
      }

      // Check if state change is needed
      if (issue.state.id === targetStateId) {
        // Update sync state even if no change needed
        syncState.set(syncKey, {
          lastState: sessionState,
          lastUpdated: new Date().toISOString(),
        });
        results.skipped.push({
          identifier,
          reason: `Already in ${issue.state.name}`,
        });
        continue;
      }

      // Update issue state
      const updateSuccess = await updateIssueState(issue.id, targetStateId);

      if (updateSuccess) {
        // Add comment explaining the state change
        const comment = generateStateChangeComment(sessionState, session);
        await addComment(issue.id, comment);

        // Update sync state
        syncState.set(syncKey, {
          lastState: sessionState,
          lastUpdated: new Date().toISOString(),
        });
        saveSyncState();

        results.updated.push({
          identifier,
          fromState: issue.state.name,
          toState: sessionState,
          url: issue.url,
        });
      } else {
        results.errors.push(`Failed to update ${identifier}`);
      }
    } catch (e) {
      results.errors.push(`Error processing ${identifier}: ${e.message}`);
    }
  }

  return results;
}

/**
 * Generate a comment for state change
 * @param {string} newState - New session state
 * @param {object} session - Session data
 * @returns {string} Comment body
 */
function generateStateChangeComment(newState, session) {
  const timestamp = new Date().toISOString();
  const sessionLabel = session.label || session.key || "Unknown session";

  switch (newState) {
    case "active":
    case "live":
      return (
        `🟢 **Work resumed** on this issue.\n\n` +
        `Session: \`${sessionLabel}\`\n` +
        `Time: ${timestamp}\n\n` +
        `_Updated automatically by OpenClaw Dashboard_`
      );

    case "idle":
      return (
        `⏸️ **Work paused** on this issue (session idle >30 min).\n\n` +
        `Session: \`${sessionLabel}\`\n` +
        `Time: ${timestamp}\n\n` +
        `_Updated automatically by OpenClaw Dashboard_`
      );

    case "completed":
      return (
        `✅ **Work completed** on this issue.\n\n` +
        `Session: \`${sessionLabel}\`\n` +
        `Time: ${timestamp}\n\n` +
        `_Updated automatically by OpenClaw Dashboard_`
      );

    default:
      return (
        `📝 Session state changed to: ${newState}\n\n` +
        `Session: \`${sessionLabel}\`\n` +
        `Time: ${timestamp}`
      );
  }
}

/**
 * Read session transcript from JSONL file
 * (Mirrors the function in server.js)
 * @param {string} sessionId - Session ID
 * @returns {Array} Transcript entries
 */
function readTranscript(sessionId) {
  const openclawDir = getOpenClawDir();
  const transcriptPath = path.join(openclawDir, "agents", "main", "sessions", `${sessionId}.jsonl`);

  try {
    if (!fs.existsSync(transcriptPath)) return [];
    const content = fs.readFileSync(transcriptPath, "utf8");
    return content
      .trim()
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (e) {
    console.error("[Linear] Failed to read transcript:", e.message);
    return [];
  }
}

/**
 * Hook for server.js to call on session updates
 * @param {object} session - Session data from OpenClaw
 */
async function onSessionUpdate(session) {
  if (!session.sessionId) {
    console.error("[Linear] Session missing sessionId");
    return { error: "Missing sessionId" };
  }

  const transcript = readTranscript(session.sessionId);
  const results = await syncSessionToLinear(session, transcript);

  if (results.updated.length > 0) {
    console.log(
      `[Linear] Updated ${results.updated.length} issues:`,
      results.updated.map((u) => u.identifier).join(", "),
    );
  }

  return results;
}

/**
 * Batch sync all active sessions
 * Useful for periodic sync via cron or manual trigger
 */
async function syncAllSessions() {
  const { execSync } = require("child_process");

  try {
    const output = execSync("openclaw sessions list --json 2>/dev/null", {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });

    const data = JSON.parse(output);
    const sessions = data.sessions || [];

    const allResults = {
      sessionsProcessed: 0,
      totalIssuesFound: 0,
      totalUpdated: 0,
      errors: [],
    };

    for (const session of sessions) {
      const results = await onSessionUpdate(session);
      allResults.sessionsProcessed++;
      allResults.totalIssuesFound += results.issuesFound?.length || 0;
      allResults.totalUpdated += results.updated?.length || 0;
      if (results.errors?.length) {
        allResults.errors.push(...results.errors);
      }
    }

    return allResults;
  } catch (e) {
    console.error("[Linear] Failed to sync all sessions:", e.message);
    return { error: e.message };
  }
}

// Initialize: load sync state
loadSyncState();

// Exports for server.js integration
module.exports = {
  // Core functions
  extractLinearIds,
  extractLinearIdsFromTranscript,
  getIssue,
  updateIssueState,
  addComment,

  // Session sync
  syncSessionToLinear,
  onSessionUpdate,
  syncAllSessions,

  // State helpers
  determineSessionState,

  // Constants
  LINEAR_STATES,
  STATE_MAP,
};

// CLI mode: run sync if called directly
if (require.main === module) {
  console.log("[Linear] Running batch sync...");
  syncAllSessions()
    .then((results) => {
      console.log("[Linear] Sync complete:", JSON.stringify(results, null, 2));
      process.exit(results.error ? 1 : 0);
    })
    .catch((e) => {
      console.error("[Linear] Sync failed:", e.message);
      process.exit(1);
    });
}
