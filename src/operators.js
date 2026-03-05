const fs = require("fs");
const path = require("path");

function loadOperators(dataDir) {
  const operatorsFile = path.join(dataDir, "operators.json");
  try {
    if (fs.existsSync(operatorsFile)) {
      return JSON.parse(fs.readFileSync(operatorsFile, "utf8"));
    }
  } catch (e) {
    console.error("Failed to load operators:", e.message);
  }
  return { version: 1, operators: [], roles: {} };
}

function saveOperators(dataDir, data) {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const operatorsFile = path.join(dataDir, "operators.json");
    fs.writeFileSync(operatorsFile, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error("Failed to save operators:", e.message);
    return false;
  }
}

function getOperatorBySlackId(dataDir, slackId) {
  const data = loadOperators(dataDir);
  return data.operators.find((op) => op.id === slackId || op.metadata?.slackId === slackId);
}

// Auto-detect operators from session transcripts (runs async in background)
let operatorsRefreshing = false;
async function refreshOperatorsAsync(dataDir, getOpenClawDir) {
  if (operatorsRefreshing) return;
  operatorsRefreshing = true;

  // Normalize timestamp to ms (handles ISO strings, numbers, and fallback)
  const toMs = (ts, fallback) => {
    if (typeof ts === "number" && Number.isFinite(ts)) return ts;
    if (typeof ts === "string") {
      const parsed = Date.parse(ts);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  };

  try {
    const openclawDir = getOpenClawDir();
    const sessionsDir = path.join(openclawDir, "agents", "main", "sessions");

    if (!fs.existsSync(sessionsDir)) {
      operatorsRefreshing = false;
      return;
    }

    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    const operatorsMap = new Map(); // userId -> operator data
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    for (const file of files) {
      const filePath = path.join(sessionsDir, file);
      try {
        const stat = fs.statSync(filePath);
        // Only scan files modified in last 7 days
        if (stat.mtimeMs < sevenDaysAgo) continue;

        // Read first 10KB of each file (enough to get user info)
        const fd = fs.openSync(filePath, "r");
        const buffer = Buffer.alloc(10240);
        const bytesRead = fs.readSync(fd, buffer, 0, 10240, 0);
        fs.closeSync(fd);

        const content = buffer.toString("utf8", 0, bytesRead);
        const lines = content.split("\n").slice(0, 20); // First 20 lines

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.type !== "message" || !entry.message) continue;

            const msg = entry.message;
            if (msg.role !== "user") continue;

            let text = "";
            if (typeof msg.content === "string") {
              text = msg.content;
            } else if (Array.isArray(msg.content)) {
              const textPart = msg.content.find((c) => c.type === "text");
              if (textPart) text = textPart.text || "";
            }

            if (!text) continue;

            // Extract Slack user: "[Slack #channel +Xm date] username (USERID):"
            const slackMatch = text.match(/\[Slack[^\]]*\]\s*([\w.-]+)\s*\(([A-Z0-9]+)\):/);
            if (slackMatch) {
              const username = slackMatch[1];
              const userId = slackMatch[2];

              if (!operatorsMap.has(userId)) {
                operatorsMap.set(userId, {
                  id: userId,
                  name: username,
                  username: username,
                  source: "slack",
                  firstSeen: toMs(entry.timestamp, stat.mtimeMs),
                  lastSeen: toMs(entry.timestamp, stat.mtimeMs),
                  sessionCount: 1,
                });
              } else {
                const op = operatorsMap.get(userId);
                op.lastSeen = Math.max(op.lastSeen, toMs(entry.timestamp, stat.mtimeMs));
                op.sessionCount++;
              }
              break; // Found user for this session, move to next file
            }

            // Also check for Telegram users: "[Telegram +Xm date] username:"
            const telegramMatch = text.match(/\[Telegram[^\]]*\]\s*([\w.-]+):/);
            if (telegramMatch) {
              const username = telegramMatch[1];
              const operatorId = `telegram:${username}`;

              if (!operatorsMap.has(operatorId)) {
                operatorsMap.set(operatorId, {
                  id: operatorId,
                  name: username,
                  username: username,
                  source: "telegram",
                  firstSeen: toMs(entry.timestamp, stat.mtimeMs),
                  lastSeen: toMs(entry.timestamp, stat.mtimeMs),
                  sessionCount: 1,
                });
              } else {
                const op = operatorsMap.get(operatorId);
                op.lastSeen = Math.max(op.lastSeen, toMs(entry.timestamp, stat.mtimeMs));
                op.sessionCount++;
              }
              break;
            }

            // Check for Discord users in "Conversation info" JSON block
            // Pattern: "sender": "123456789012345678" and "label": "CoolUser123"
            const discordSenderMatch = text.match(/"sender":\s*"(\d+)"/);
            const discordLabelMatch = text.match(/"label":\s*"([^"]+)"/);
            const discordUsernameMatch = text.match(/"username":\s*"([^"]+)"/);

            if (discordSenderMatch) {
              const userId = discordSenderMatch[1];
              const label = discordLabelMatch ? discordLabelMatch[1] : userId;
              const username = discordUsernameMatch ? discordUsernameMatch[1] : label;
              const opId = `discord:${userId}`;

              if (!operatorsMap.has(opId)) {
                operatorsMap.set(opId, {
                  id: opId,
                  discordId: userId,
                  name: label,
                  username: username,
                  source: "discord",
                  firstSeen: toMs(entry.timestamp, stat.mtimeMs),
                  lastSeen: toMs(entry.timestamp, stat.mtimeMs),
                  sessionCount: 1,
                });
              } else {
                const op = operatorsMap.get(opId);
                op.lastSeen = Math.max(op.lastSeen, toMs(entry.timestamp, stat.mtimeMs));
                op.sessionCount++;
              }
              break;
            }
          } catch (e) {
            /* skip invalid lines */
          }
        }
      } catch (e) {
        /* skip unreadable files */
      }
    }

    // Load existing operators to preserve manual edits
    const existing = loadOperators(dataDir);
    const existingMap = new Map(existing.operators.map((op) => [op.id, op]));

    // Merge: auto-detected + existing manual entries
    for (const [id, autoOp] of operatorsMap) {
      if (existingMap.has(id)) {
        // Update stats but preserve manual fields
        const manual = existingMap.get(id);
        manual.lastSeen = Math.max(manual.lastSeen || 0, autoOp.lastSeen);
        manual.sessionCount = (manual.sessionCount || 0) + autoOp.sessionCount;
      } else {
        existingMap.set(id, autoOp);
      }
    }

    // Save merged operators
    const merged = {
      version: 1,
      operators: Array.from(existingMap.values()).sort(
        (a, b) => (b.lastSeen || 0) - (a.lastSeen || 0),
      ),
      roles: existing.roles || {},
      lastRefreshed: Date.now(),
    };

    saveOperators(dataDir, merged);
    console.log(`[Operators] Refreshed: ${merged.operators.length} operators detected`);
  } catch (e) {
    console.error("[Operators] Refresh failed:", e.message);
  }

  operatorsRefreshing = false;
}

// Start background operators refresh (caller invokes this instead of auto-starting on load)
function startOperatorsRefresh(dataDir, getOpenClawDir) {
  setTimeout(() => refreshOperatorsAsync(dataDir, getOpenClawDir), 2000);
  setInterval(() => refreshOperatorsAsync(dataDir, getOpenClawDir), 5 * 60 * 1000); // Every 5 minutes
}

module.exports = {
  loadOperators,
  saveOperators,
  getOperatorBySlackId,
  refreshOperatorsAsync,
  startOperatorsRefresh,
};
