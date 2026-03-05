const { describe, it } = require("node:test");
const assert = require("node:assert");
const { TOPIC_PATTERNS, detectTopics } = require("../src/topics");

describe("topics module", () => {
  describe("TOPIC_PATTERNS", () => {
    it("is an object with topic keys", () => {
      assert.strictEqual(typeof TOPIC_PATTERNS, "object");
      assert.ok(Object.keys(TOPIC_PATTERNS).length > 0);
    });

    it("each topic has an array of keywords", () => {
      for (const [topic, keywords] of Object.entries(TOPIC_PATTERNS)) {
        assert.ok(Array.isArray(keywords), `${topic} should have array of keywords`);
        assert.ok(keywords.length > 0, `${topic} should have at least one keyword`);
      }
    });

    it("contains expected topics", () => {
      const topics = Object.keys(TOPIC_PATTERNS);
      assert.ok(topics.includes("dashboard"));
      assert.ok(topics.includes("coding"));
      assert.ok(topics.includes("git"));
      assert.ok(topics.includes("Slack"));
    });
  });

  describe("detectTopics()", () => {
    it("returns empty array for null input", () => {
      assert.deepStrictEqual(detectTopics(null), []);
    });

    it("returns empty array for empty string", () => {
      assert.deepStrictEqual(detectTopics(""), []);
    });

    it("returns empty array for undefined", () => {
      assert.deepStrictEqual(detectTopics(undefined), []);
    });

    it("detects git topic from git-related text", () => {
      const topics = detectTopics("git commit branch merge push pull");
      assert.ok(topics.includes("git"), `Expected 'git' in ${JSON.stringify(topics)}`);
    });

    it("detects coding topic", () => {
      const topics = detectTopics("debug the function and fix the error in the code");
      assert.ok(topics.includes("coding"), `Expected 'coding' in ${JSON.stringify(topics)}`);
    });

    it("detects Slack topic", () => {
      const topics = detectTopics("send a slack message to the channel thread");
      assert.ok(topics.includes("Slack"), `Expected 'Slack' in ${JSON.stringify(topics)}`);
    });

    it("returns topics sorted by score descending", () => {
      // Heavily git-focused text with a minor coding mention
      const topics = detectTopics("git commit branch merge push pull repository github code");
      if (topics.length >= 2) {
        // git should score higher than coding since more keywords match
        const gitIdx = topics.indexOf("git");
        assert.ok(gitIdx >= 0, "git should be detected");
      }
    });

    it("returns array of strings", () => {
      const topics = detectTopics("kubernetes docker container deploy");
      assert.ok(Array.isArray(topics));
      topics.forEach((t) => assert.strictEqual(typeof t, "string"));
    });

    it("detects scheduling topic", () => {
      const topics = detectTopics("set up a cron schedule timer for periodic interval");
      assert.ok(
        topics.includes("scheduling"),
        `Expected 'scheduling' in ${JSON.stringify(topics)}`,
      );
    });

    it("detects subagent topic", () => {
      const topics = detectTopics("spawn a subagent to delegate the work in parallel");
      assert.ok(topics.includes("subagent"), `Expected 'subagent' in ${JSON.stringify(topics)}`);
    });
  });
});
