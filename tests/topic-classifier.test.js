const { describe, it } = require("node:test");
const assert = require("node:assert");

// Import the module under test (avoid side-effect heavy parts by importing functions directly)
const {
  classifyAndSuggestTopics,
  extractKeyTerms,
  matchTopics,
  CONFIG,
  TOPIC_PATTERNS,
} = require("../scripts/topic-classifier");

describe("topic-classifier module", () => {
  describe("exports", () => {
    it("exports classifyAndSuggestTopics function", () => {
      assert.strictEqual(typeof classifyAndSuggestTopics, "function");
    });

    it("exports extractKeyTerms function", () => {
      assert.strictEqual(typeof extractKeyTerms, "function");
    });

    it("exports matchTopics function", () => {
      assert.strictEqual(typeof matchTopics, "function");
    });

    it("exports CONFIG object", () => {
      assert.ok(CONFIG, "CONFIG should be exported");
      assert.strictEqual(typeof CONFIG.matchThreshold, "number");
      assert.strictEqual(typeof CONFIG.minTermScore, "number");
    });

    it("exports TOPIC_PATTERNS object", () => {
      assert.ok(TOPIC_PATTERNS, "TOPIC_PATTERNS should be exported");
      assert.strictEqual(typeof TOPIC_PATTERNS, "object");
      assert.ok(Object.keys(TOPIC_PATTERNS).length > 0, "should have patterns");
    });
  });

  describe("extractKeyTerms()", () => {
    it("returns an array", () => {
      const result = extractKeyTerms("some text about kubernetes deployment");
      assert.ok(Array.isArray(result));
    });

    it("returns empty array for empty string", () => {
      const result = extractKeyTerms("");
      assert.deepStrictEqual(result, []);
    });

    it("returns empty array for null input", () => {
      const result = extractKeyTerms(null);
      assert.deepStrictEqual(result, []);
    });

    it("returns empty array for undefined input", () => {
      const result = extractKeyTerms(undefined);
      assert.deepStrictEqual(result, []);
    });

    it("filters out stop words", () => {
      const result = extractKeyTerms("the and or but kubernetes kubernetes deployment deployment");
      const terms = result.map((t) => t.term);
      assert.ok(!terms.includes("the"));
      assert.ok(!terms.includes("and"));
    });

    it("each result has term and score properties", () => {
      const result = extractKeyTerms(
        "docker container docker container kubernetes kubernetes pod pod",
      );
      for (const entry of result) {
        assert.ok("term" in entry, `entry should have 'term' property: ${JSON.stringify(entry)}`);
        assert.ok("score" in entry, `entry should have 'score' property: ${JSON.stringify(entry)}`);
        assert.strictEqual(typeof entry.term, "string");
        assert.strictEqual(typeof entry.score, "number");
      }
    });

    it("scores are sorted descending", () => {
      const result = extractKeyTerms(
        "kubernetes kubernetes kubernetes docker docker terraform terraform terraform terraform deploy deploy deploy deploy",
      );
      for (let i = 1; i < result.length; i++) {
        assert.ok(
          result[i - 1].score >= result[i].score,
          `Score at index ${i - 1} (${result[i - 1].score}) should be >= score at index ${i} (${result[i].score})`,
        );
      }
    });

    it("strips code blocks from text", () => {
      const result = extractKeyTerms(
        "kubernetes kubernetes ```const x = kubernetes;``` kubernetes deployment deployment",
      );
      // The code block content should be stripped, so only tokens from outside code blocks
      const terms = result.map((t) => t.term);
      // 'const' from code block should not appear
      assert.ok(!terms.includes("const"), "should not include tokens from code blocks");
    });

    it("strips URLs from text", () => {
      const result = extractKeyTerms(
        "kubernetes kubernetes https://example.com/kubernetes kubernetes deployment deployment",
      );
      const terms = result.map((t) => t.term);
      assert.ok(!terms.includes("https"), "should not include URL protocol as token");
    });
  });

  describe("matchTopics()", () => {
    const existingTopics = [
      "version-control",
      "deployment",
      "database",
      "testing",
      "ai-ml",
      "containers",
    ];

    it("returns an array", () => {
      const result = matchTopics("some text about deploying code", existingTopics);
      assert.ok(Array.isArray(result));
    });

    it("returns empty array for empty text", () => {
      const result = matchTopics("", existingTopics);
      assert.deepStrictEqual(result, []);
    });

    it("matches deployment topic for deploy-related text", () => {
      const result = matchTopics(
        "deploying to production staging pipeline deploy deploy",
        existingTopics,
      );
      const topics = result.map((r) => r.topic);
      assert.ok(
        topics.includes("deployment"),
        `Expected 'deployment' in ${JSON.stringify(topics)}`,
      );
    });

    it("matches database topic for SQL-related text", () => {
      const result = matchTopics(
        "postgres database query sql optimization postgres query",
        existingTopics,
      );
      const topics = result.map((r) => r.topic);
      assert.ok(topics.includes("database"), `Expected 'database' in ${JSON.stringify(topics)}`);
    });

    it("matches containers topic for docker/k8s text", () => {
      const result = matchTopics(
        "docker container kubernetes pod k8s container docker",
        existingTopics,
      );
      const topics = result.map((r) => r.topic);
      assert.ok(
        topics.includes("containers"),
        `Expected 'containers' in ${JSON.stringify(topics)}`,
      );
    });

    it("results have topic and confidence properties", () => {
      const result = matchTopics("git commit branch merge pull push github", existingTopics);
      for (const entry of result) {
        assert.ok("topic" in entry);
        assert.ok("confidence" in entry);
        assert.strictEqual(typeof entry.confidence, "number");
        assert.ok(entry.confidence >= 0 && entry.confidence <= 1);
      }
    });

    it("results are sorted by confidence descending", () => {
      const result = matchTopics(
        "git commit branch merge deploy production staging",
        existingTopics,
      );
      for (let i = 1; i < result.length; i++) {
        assert.ok(
          result[i - 1].confidence >= result[i].confidence,
          `Confidence at index ${i - 1} should be >= index ${i}`,
        );
      }
    });
  });

  describe("classifyAndSuggestTopics()", () => {
    it("returns object with matched, suggested, keyTerms", () => {
      const result = classifyAndSuggestTopics(
        "kubernetes deployment docker container kubernetes docker deployment",
        ["containers", "deployment"],
        { persist: false },
      );
      assert.ok(Array.isArray(result.matched));
      assert.ok(Array.isArray(result.suggested));
      assert.ok(Array.isArray(result.keyTerms));
    });

    it("returns empty results for very short text", () => {
      const result = classifyAndSuggestTopics("hi", [], { persist: false });
      assert.deepStrictEqual(result.matched, []);
      assert.deepStrictEqual(result.suggested, []);
      assert.deepStrictEqual(result.keyTerms, []);
    });

    it("returns empty results for null input", () => {
      const result = classifyAndSuggestTopics(null, [], { persist: false });
      assert.deepStrictEqual(result.matched, []);
    });

    it("handles array transcript input", () => {
      const transcript = [
        "kubernetes deployment docker container",
        "kubernetes docker deployment staging production",
        "more kubernetes docker content here deploy",
      ];
      const result = classifyAndSuggestTopics(transcript, ["deployment"], {
        persist: false,
      });
      assert.ok(Array.isArray(result.matched));
    });

    it("handles array of message objects", () => {
      const transcript = [
        { text: "kubernetes deployment docker container" },
        { text: "kubernetes docker deployment staging" },
        { text: "more content about kubernetes docker" },
      ];
      const result = classifyAndSuggestTopics(transcript, ["deployment"], {
        persist: false,
      });
      assert.ok(Array.isArray(result.matched));
    });

    it("provides confidence score", () => {
      const result = classifyAndSuggestTopics(
        "kubernetes deployment docker container kubernetes docker deployment pod staging",
        ["containers", "deployment"],
        { persist: false },
      );
      assert.strictEqual(typeof result.confidence, "number");
    });
  });

  describe("TOPIC_PATTERNS", () => {
    it("maps git to version-control", () => {
      assert.strictEqual(TOPIC_PATTERNS["git"], "version-control");
    });

    it("maps docker to containers", () => {
      assert.strictEqual(TOPIC_PATTERNS["docker"], "containers");
    });

    it("maps claude to ai-ml", () => {
      assert.strictEqual(TOPIC_PATTERNS["claude"], "ai-ml");
    });

    it("maps postgres to database", () => {
      assert.strictEqual(TOPIC_PATTERNS["postgres"], "database");
    });
  });
});
