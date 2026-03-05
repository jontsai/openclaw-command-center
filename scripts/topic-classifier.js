/**
 * Topic Classifier for OpenClaw Sessions
 *
 * Analyzes session transcript content to:
 * - Match against existing topics
 * - Detect when existing topics don't fit well
 * - Suggest new topic names based on content patterns
 * - Maintain a discovered-topics.json file for learned topics
 *
 * @module topic-classifier
 */

const fs = require("fs");
const path = require("path");
const { CONFIG: APP_CONFIG } = require("../src/config");

// Default config
const CONFIG = {
  // Minimum TF-IDF score to consider a term significant
  minTermScore: 0.1,
  // Minimum topic match confidence to consider a match "good"
  matchThreshold: 0.3,
  // Minimum occurrences for a term to be considered
  minTermFrequency: 2,
  // Path to discovered topics state file
  discoveredTopicsPath: path.join(APP_CONFIG.paths.state, "discovered-topics.json"),
  // Maximum suggested topics per classification
  maxSuggestions: 3,
};

// Stop words to filter out (common English words)
const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "up",
  "about",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "between",
  "under",
  "again",
  "further",
  "then",
  "once",
  "here",
  "there",
  "when",
  "where",
  "why",
  "how",
  "all",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "s",
  "t",
  "can",
  "will",
  "just",
  "don",
  "should",
  "now",
  "i",
  "me",
  "my",
  "myself",
  "we",
  "our",
  "ours",
  "you",
  "your",
  "yours",
  "he",
  "him",
  "his",
  "she",
  "her",
  "hers",
  "it",
  "its",
  "they",
  "them",
  "their",
  "theirs",
  "what",
  "which",
  "who",
  "whom",
  "this",
  "that",
  "these",
  "those",
  "am",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "having",
  "do",
  "does",
  "did",
  "doing",
  "would",
  "could",
  "ought",
  "let",
  "like",
  "need",
  "want",
  "got",
  "get",
  "make",
  "made",
  "see",
  "look",
  "think",
  "know",
  "take",
  "come",
  "go",
  "say",
  "said",
  "tell",
  "told",
  "ask",
  "use",
  "used",
  "find",
  "give",
  "gave",
  "yes",
  "no",
  "ok",
  "okay",
  "yeah",
  "sure",
  "right",
  "well",
  "also",
  "just",
  "really",
  "actually",
  "basically",
  "probably",
  "maybe",
  // Tech-common words that are too generic
  "file",
  "code",
  "run",
  "check",
  "help",
  "please",
  "thanks",
  "hello",
  "hi",
  "hey",
  "good",
  "great",
  "nice",
  "cool",
  "awesome",
  "perfect",
]);

// Known topic patterns for seeding - maps keywords to topic names
const TOPIC_PATTERNS = {
  // Development
  git: "version-control",
  github: "version-control",
  commit: "version-control",
  branch: "version-control",
  merge: "version-control",
  pull: "version-control",
  push: "version-control",

  debug: "debugging",
  error: "debugging",
  bug: "debugging",
  fix: "debugging",
  stack: "debugging",
  trace: "debugging",
  exception: "debugging",

  test: "testing",
  unittest: "testing",
  jest: "testing",
  pytest: "testing",
  coverage: "testing",

  deploy: "deployment",
  production: "deployment",
  staging: "deployment",
  ci: "deployment",
  cd: "deployment",
  pipeline: "deployment",

  api: "api-integration",
  endpoint: "api-integration",
  rest: "api-integration",
  graphql: "api-integration",
  webhook: "api-integration",

  database: "database",
  sql: "database",
  postgres: "database",
  mysql: "database",
  mongodb: "database",
  query: "database",

  docker: "containers",
  kubernetes: "containers",
  k8s: "containers",
  container: "containers",
  pod: "containers",

  aws: "cloud-infra",
  gcp: "cloud-infra",
  azure: "cloud-infra",
  terraform: "cloud-infra",
  cloudformation: "cloud-infra",

  // Communication
  slack: "slack-integration",
  channel: "slack-integration",
  message: "messaging",
  email: "email",
  notification: "notifications",

  // Automation
  cron: "scheduling",
  schedule: "scheduling",
  timer: "scheduling",
  job: "scheduling",

  script: "automation",
  automate: "automation",
  workflow: "automation",

  // Research
  research: "research",
  search: "research",
  wikipedia: "research",
  lookup: "research",

  // Finance
  finance: "finance",
  investment: "finance",
  stock: "finance",
  portfolio: "finance",
  budget: "finance",

  // System
  config: "configuration",
  settings: "configuration",
  setup: "configuration",
  install: "setup",

  // Writing
  document: "documentation",
  readme: "documentation",
  docs: "documentation",
  write: "writing",
  draft: "writing",

  // AI/ML
  model: "ai-ml",
  claude: "ai-ml",
  openai: "ai-ml",
  gpt: "ai-ml",
  llm: "ai-ml",
  prompt: "prompt-engineering",

  // UI
  dashboard: "dashboard",
  ui: "ui-development",
  frontend: "ui-development",
  css: "ui-development",
  html: "ui-development",
  react: "ui-development",
};

/**
 * Tokenize text into words
 * @param {string} text - Raw text to tokenize
 * @returns {string[]} Array of lowercase tokens
 */
function tokenize(text) {
  if (!text || typeof text !== "string") return [];

  return (
    text
      .toLowerCase()
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, " ")
      // Remove inline code
      .replace(/`[^`]+`/g, " ")
      // Remove URLs
      .replace(/https?:\/\/\S+/g, " ")
      // Remove special characters but keep hyphens in words
      .replace(/[^a-z0-9\s-]/g, " ")
      // Split on whitespace
      .split(/\s+/)
      // Filter valid tokens
      .filter(
        (token) =>
          token.length > 2 && token.length < 30 && !STOP_WORDS.has(token) && !/^\d+$/.test(token),
      )
  );
}

/**
 * Calculate term frequency for a document
 * @param {string[]} tokens - Array of tokens
 * @returns {Map<string, number>} Term frequency map
 */
function calculateTF(tokens) {
  const tf = new Map();
  const total = tokens.length || 1;

  tokens.forEach((token) => {
    tf.set(token, (tf.get(token) || 0) + 1);
  });

  // Normalize by document length
  tf.forEach((count, term) => {
    tf.set(term, count / total);
  });

  return tf;
}

/**
 * Calculate inverse document frequency using corpus statistics
 * For a single document, we use term rarity as a proxy
 * @param {Map<string, number>} tf - Term frequency map
 * @param {number} vocabSize - Size of vocabulary
 * @returns {Map<string, number>} IDF scores
 */
function calculateIDF(tf, vocabSize) {
  const idf = new Map();

  tf.forEach((freq, term) => {
    // Boost terms that appear in known patterns
    const patternBoost = TOPIC_PATTERNS[term] ? 2.0 : 1.0;
    // Simple IDF approximation: rarer terms get higher scores
    const score = Math.log(vocabSize / (1 + freq * vocabSize)) * patternBoost;
    idf.set(term, Math.max(0, score));
  });

  return idf;
}

/**
 * Extract key terms using TF-IDF
 * @param {string} text - Text to analyze
 * @returns {Array<{term: string, score: number}>} Ranked terms
 */
function extractKeyTerms(text) {
  const tokens = tokenize(text);
  if (tokens.length === 0) return [];

  const tf = calculateTF(tokens);
  const idf = calculateIDF(tf, tf.size);

  const tfidf = [];
  tf.forEach((tfScore, term) => {
    const idfScore = idf.get(term) || 0;
    const score = tfScore * idfScore;

    // Only include terms that meet minimum thresholds
    const rawCount = tokens.filter((t) => t === term).length;
    if (rawCount >= CONFIG.minTermFrequency && score >= CONFIG.minTermScore) {
      tfidf.push({ term, score, count: rawCount });
    }
  });

  // Sort by score descending
  return tfidf.sort((a, b) => b.score - a.score);
}

/**
 * Match text against existing topics
 * @param {string} text - Text to match
 * @param {string[]} existingTopics - List of existing topic names
 * @returns {Array<{topic: string, confidence: number}>} Matched topics with confidence
 */
function matchTopics(text, existingTopics) {
  const tokens = tokenize(text);
  const matches = new Map();

  // Score each existing topic
  existingTopics.forEach((topic) => {
    let score = 0;
    const topicTokens = tokenize(topic);

    // Direct token match
    topicTokens.forEach((tt) => {
      const count = tokens.filter((t) => t === tt || t.includes(tt) || tt.includes(t)).length;
      score += count * 0.3;
    });

    // Pattern-based matching
    tokens.forEach((token) => {
      const mappedTopic = TOPIC_PATTERNS[token];
      if (mappedTopic === topic) {
        score += 0.5;
      }
    });

    if (score > 0) {
      // Normalize by text length (log scale to avoid penalizing long texts too much)
      const normalizedScore = score / Math.log2(tokens.length + 2);
      matches.set(topic, Math.min(1, normalizedScore));
    }
  });

  // Convert to sorted array
  return Array.from(matches.entries())
    .map(([topic, confidence]) => ({ topic, confidence }))
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * Generate topic suggestions based on content
 * @param {Array<{term: string, score: number}>} keyTerms - Key terms from text
 * @param {string[]} existingTopics - Topics to avoid suggesting
 * @returns {string[]} Suggested new topic names
 */
function generateSuggestions(keyTerms, existingTopics) {
  const existingSet = new Set(existingTopics.map((t) => t.toLowerCase()));
  const suggestions = new Set();

  // Strategy 1: Use known patterns for top terms
  keyTerms.slice(0, 15).forEach(({ term }) => {
    const mapped = TOPIC_PATTERNS[term];
    if (mapped && !existingSet.has(mapped)) {
      suggestions.add(mapped);
    }
  });

  // Strategy 2: Create compound topics from top co-occurring terms
  if (keyTerms.length >= 2 && suggestions.size < CONFIG.maxSuggestions) {
    const topTerms = keyTerms.slice(0, 5).map((t) => t.term);

    // Look for related pairs
    const pairs = [
      ["api", "integration"],
      ["code", "review"],
      ["data", "analysis"],
      ["error", "handling"],
      ["file", "management"],
      ["memory", "optimization"],
      ["performance", "tuning"],
      ["security", "audit"],
      ["system", "design"],
      ["user", "interface"],
    ];

    pairs.forEach(([a, b]) => {
      if (topTerms.some((t) => t.includes(a)) && topTerms.some((t) => t.includes(b))) {
        const compound = `${a}-${b}`;
        if (!existingSet.has(compound)) {
          suggestions.add(compound);
        }
      }
    });
  }

  // Strategy 3: Use top-scoring term as-is if it's descriptive enough
  if (suggestions.size < CONFIG.maxSuggestions) {
    keyTerms.slice(0, 5).forEach(({ term, score }) => {
      // Only use single terms that are sufficiently meaningful
      if (score > 0.15 && term.length > 4 && !existingSet.has(term)) {
        suggestions.add(term);
      }
    });
  }

  return Array.from(suggestions).slice(0, CONFIG.maxSuggestions);
}

/**
 * Load discovered topics from state file
 * @returns {Object} Discovered topics data
 */
function loadDiscoveredTopics() {
  try {
    if (fs.existsSync(CONFIG.discoveredTopicsPath)) {
      return JSON.parse(fs.readFileSync(CONFIG.discoveredTopicsPath, "utf8"));
    }
  } catch (e) {
    console.error("Failed to load discovered topics:", e.message);
  }

  return {
    version: 1,
    topics: {},
    lastUpdated: null,
  };
}

/**
 * Save discovered topics to state file
 * @param {Object} data - Topics data to save
 */
function saveDiscoveredTopics(data) {
  try {
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(CONFIG.discoveredTopicsPath, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Failed to save discovered topics:", e.message);
  }
}

/**
 * Update discovered topics with new suggestions
 * @param {string[]} suggestions - New topic suggestions
 * @param {string} sessionKey - Source session identifier
 */
function updateDiscoveredTopics(suggestions, sessionKey) {
  const data = loadDiscoveredTopics();

  suggestions.forEach((topic) => {
    if (!data.topics[topic]) {
      data.topics[topic] = {
        firstSeen: new Date().toISOString(),
        occurrences: 0,
        sessions: [],
      };
    }

    data.topics[topic].occurrences++;
    data.topics[topic].lastSeen = new Date().toISOString();

    if (!data.topics[topic].sessions.includes(sessionKey)) {
      data.topics[topic].sessions.push(sessionKey);
      // Keep only last 10 sessions
      if (data.topics[topic].sessions.length > 10) {
        data.topics[topic].sessions.shift();
      }
    }
  });

  saveDiscoveredTopics(data);
}

/**
 * Main classification function
 * Analyzes transcript content to match existing topics and suggest new ones
 *
 * @param {string|Array} transcript - Session transcript (string or array of messages)
 * @param {string[]} existingTopics - List of existing topic names
 * @param {Object} options - Optional configuration
 * @param {string} options.sessionKey - Session identifier for tracking
 * @param {boolean} options.persist - Whether to persist discovered topics (default: true)
 * @returns {{matched: Array<{topic: string, confidence: number}>, suggested: string[], keyTerms: Array}}
 */
function classifyAndSuggestTopics(transcript, existingTopics = [], options = {}) {
  // Normalize transcript to text
  let text = "";
  if (Array.isArray(transcript)) {
    text = transcript
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry.text) return entry.text;
        if (entry.message?.content) {
          const content = entry.message.content;
          if (typeof content === "string") return content;
          if (Array.isArray(content)) {
            return content
              .filter((c) => c.type === "text")
              .map((c) => c.text || "")
              .join(" ");
          }
        }
        return "";
      })
      .join("\n");
  } else if (typeof transcript === "string") {
    text = transcript;
  }

  if (!text || text.length < 20) {
    return { matched: [], suggested: [], keyTerms: [] };
  }

  // Extract key terms
  const keyTerms = extractKeyTerms(text);

  // Match against existing topics
  const matched = matchTopics(text, existingTopics);

  // Determine if we need suggestions
  const bestMatch = matched[0];
  const needsSuggestions = !bestMatch || bestMatch.confidence < CONFIG.matchThreshold;

  let suggested = [];
  if (needsSuggestions) {
    suggested = generateSuggestions(keyTerms, existingTopics);

    // Persist discovered topics if enabled
    if (options.persist !== false && suggested.length > 0 && options.sessionKey) {
      updateDiscoveredTopics(suggested, options.sessionKey);
    }
  }

  return {
    matched: matched.slice(0, 5),
    suggested,
    keyTerms: keyTerms.slice(0, 10),
    confidence: bestMatch?.confidence || 0,
  };
}

/**
 * Get all discovered topics sorted by occurrence
 * @returns {Array<{name: string, occurrences: number, sessions: number}>}
 */
function getDiscoveredTopics() {
  const data = loadDiscoveredTopics();

  return Object.entries(data.topics)
    .map(([name, info]) => ({
      name,
      occurrences: info.occurrences,
      sessions: info.sessions?.length || 0,
      firstSeen: info.firstSeen,
      lastSeen: info.lastSeen,
    }))
    .sort((a, b) => b.occurrences - a.occurrences);
}

/**
 * Promote a discovered topic to the official topic list
 * Returns the topic data for external handling
 * @param {string} topicName - Topic to promote
 * @returns {Object|null} Topic data or null if not found
 */
function promoteDiscoveredTopic(topicName) {
  const data = loadDiscoveredTopics();

  if (data.topics[topicName]) {
    const topicData = { ...data.topics[topicName], name: topicName };
    delete data.topics[topicName];
    saveDiscoveredTopics(data);
    return topicData;
  }

  return null;
}

// Export public API
module.exports = {
  classifyAndSuggestTopics,
  getDiscoveredTopics,
  promoteDiscoveredTopic,
  extractKeyTerms,
  matchTopics,
  // Export config for testing/tuning
  CONFIG,
  TOPIC_PATTERNS,
};
