const TOPIC_PATTERNS = {
  dashboard: ["dashboard", "command center", "ui", "interface", "status page"],
  scheduling: ["cron", "schedule", "timer", "reminder", "alarm", "periodic", "interval"],
  heartbeat: [
    "heartbeat",
    "heartbeat_ok",
    "poll",
    "health check",
    "ping",
    "keepalive",
    "monitoring",
  ],
  memory: ["memory", "remember", "recall", "notes", "journal", "log", "context"],
  Slack: ["slack", "channel", "#cc-", "thread", "mention", "dm", "workspace"],
  email: ["email", "mail", "inbox", "gmail", "send email", "unread", "compose"],
  calendar: ["calendar", "event", "meeting", "appointment", "schedule", "gcal"],
  coding: [
    "code",
    "script",
    "function",
    "debug",
    "error",
    "bug",
    "implement",
    "refactor",
    "programming",
  ],
  git: [
    "git",
    "commit",
    "branch",
    "merge",
    "push",
    "pull",
    "repository",
    "pr",
    "pull request",
    "github",
  ],
  "file editing": ["file", "edit", "write", "read", "create", "delete", "modify", "save"],
  API: ["api", "endpoint", "request", "response", "webhook", "integration", "rest", "graphql"],
  research: ["search", "research", "lookup", "find", "investigate", "learn", "study"],
  browser: ["browser", "webpage", "website", "url", "click", "navigate", "screenshot", "web_fetch"],
  "Quip export": ["quip", "export", "document", "spreadsheet"],
  finance: ["finance", "investment", "stock", "money", "budget", "bank", "trading", "portfolio"],
  home: ["home", "automation", "lights", "thermostat", "smart home", "iot", "homekit"],
  health: ["health", "fitness", "workout", "exercise", "weight", "sleep", "nutrition"],
  travel: ["travel", "flight", "hotel", "trip", "vacation", "booking", "airport"],
  food: ["food", "recipe", "restaurant", "cooking", "meal", "order", "delivery"],
  subagent: ["subagent", "spawn", "sub-agent", "delegate", "worker", "parallel"],
  tools: ["tool", "exec", "shell", "command", "terminal", "bash", "run"],
};

function detectTopics(text) {
  if (!text) return [];
  const lowerText = text.toLowerCase();
  const scores = {};
  for (const [topic, keywords] of Object.entries(TOPIC_PATTERNS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (keyword.length <= 3) {
        const regex = new RegExp(`\\b${keyword}\\b`, "i");
        if (regex.test(lowerText)) score++;
      } else if (lowerText.includes(keyword)) {
        score++;
      }
    }
    if (score > 0) {
      scores[topic] = score;
    }
  }
  if (Object.keys(scores).length === 0) return [];
  const bestScore = Math.max(...Object.values(scores));
  const threshold = Math.max(2, bestScore * 0.5);
  return Object.entries(scores)
    .filter(([_, score]) => score >= threshold || (score >= 1 && bestScore <= 2))
    .sort((a, b) => b[1] - a[1])
    .map(([topic, _]) => topic);
}

module.exports = { TOPIC_PATTERNS, detectTopics };
