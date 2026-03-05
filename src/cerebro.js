/**
 * Cerebro topic management
 */

const fs = require("fs");
const path = require("path");
const { formatTimeAgo } = require("./utils");

/**
 * Get cerebro topics
 * @param {string} cerebroDir - Path to cerebro directory
 * @param {object} options - Options (offset, limit, status)
 * @returns {object} - Cerebro topics data
 */
function getCerebroTopics(cerebroDir, options = {}) {
  const { offset = 0, limit = 20, status: filterStatus = "all" } = options;
  const topicsDir = path.join(cerebroDir, "topics");
  const orphansDir = path.join(cerebroDir, "orphans");
  const topics = [];

  // Result in format expected by frontend renderCerebro()
  const result = {
    initialized: false,
    cerebroPath: cerebroDir,
    topics: { active: 0, resolved: 0, parked: 0, total: 0 },
    threads: 0,
    orphans: 0,
    recentTopics: [],
    lastUpdated: null,
  };

  try {
    // Check if cerebro directory exists
    if (!fs.existsSync(cerebroDir)) {
      return result;
    }

    result.initialized = true;
    let latestModified = null;

    if (!fs.existsSync(topicsDir)) {
      return result;
    }

    const topicNames = fs.readdirSync(topicsDir).filter((name) => {
      const topicPath = path.join(topicsDir, name);
      return fs.statSync(topicPath).isDirectory() && !name.startsWith("_");
    });

    // Parse each topic
    topicNames.forEach((name) => {
      const topicMdPath = path.join(topicsDir, name, "topic.md");
      const topicDirPath = path.join(topicsDir, name);

      // Get stat from topic.md or directory
      let stat;
      let content = "";
      if (fs.existsSync(topicMdPath)) {
        stat = fs.statSync(topicMdPath);
        content = fs.readFileSync(topicMdPath, "utf8");
      } else {
        stat = fs.statSync(topicDirPath);
      }

      try {
        // Parse YAML frontmatter
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        let title = name;
        let topicStatus = "active";
        let category = "general";
        let created = null;

        if (frontmatterMatch) {
          const frontmatter = frontmatterMatch[1];
          const titleMatch = frontmatter.match(/title:\s*(.+)/);
          const statusMatch = frontmatter.match(/status:\s*(.+)/);
          const categoryMatch = frontmatter.match(/category:\s*(.+)/);
          const createdMatch = frontmatter.match(/created:\s*(.+)/);

          if (titleMatch) title = titleMatch[1].trim();
          if (statusMatch) topicStatus = statusMatch[1].trim().toLowerCase();
          if (categoryMatch) category = categoryMatch[1].trim();
          if (createdMatch) created = createdMatch[1].trim();
        }

        // Count threads
        const threadsDir = path.join(topicsDir, name, "threads");
        let threadCount = 0;
        if (fs.existsSync(threadsDir)) {
          threadCount = fs
            .readdirSync(threadsDir)
            .filter((f) => f.endsWith(".md") || f.endsWith(".json")).length;
        }

        // Accumulate total threads
        result.threads += threadCount;

        // Count by status
        if (topicStatus === "active") result.topics.active++;
        else if (topicStatus === "resolved") result.topics.resolved++;
        else if (topicStatus === "parked") result.topics.parked++;

        // Track latest modification
        if (!latestModified || stat.mtime > latestModified) {
          latestModified = stat.mtime;
        }

        topics.push({
          name,
          title,
          status: topicStatus,
          category,
          created,
          threads: threadCount,
          lastModified: stat.mtimeMs,
        });
      } catch (e) {
        console.error(`Failed to parse topic ${name}:`, e.message);
      }
    });

    result.topics.total = topics.length;

    // Sort: active first, then by most recently modified
    const statusPriority = { active: 0, resolved: 1, parked: 2 };
    topics.sort((a, b) => {
      const statusDiff = (statusPriority[a.status] || 3) - (statusPriority[b.status] || 3);
      if (statusDiff !== 0) return statusDiff;
      return b.lastModified - a.lastModified;
    });

    // Filter by status for recentTopics display
    let filtered = topics;
    if (filterStatus !== "all") {
      filtered = topics.filter((t) => t.status === filterStatus);
    }

    // Format for recentTopics (paginated)
    const paginated = filtered.slice(offset, offset + limit);
    result.recentTopics = paginated.map((t) => ({
      name: t.name,
      title: t.title,
      status: t.status,
      threads: t.threads,
      age: formatTimeAgo(new Date(t.lastModified)),
    }));

    // Count orphans
    if (fs.existsSync(orphansDir)) {
      try {
        result.orphans = fs.readdirSync(orphansDir).filter((f) => f.endsWith(".md")).length;
      } catch (e) {}
    }

    result.lastUpdated = latestModified ? latestModified.toISOString() : null;
  } catch (e) {
    console.error("Failed to get Cerebro topics:", e.message);
  }

  return result;
}

/**
 * Update topic status in topic.md file
 * @param {string} cerebroDir - Path to cerebro directory
 * @param {string} topicId - Topic identifier
 * @param {string} newStatus - New status (active, resolved, parked)
 * @returns {object} - Updated topic data or error
 */
function updateTopicStatus(cerebroDir, topicId, newStatus) {
  const topicDir = path.join(cerebroDir, "topics", topicId);
  const topicFile = path.join(topicDir, "topic.md");

  // Check if topic exists
  if (!fs.existsSync(topicDir)) {
    return { error: `Topic '${topicId}' not found`, code: 404 };
  }

  // If topic.md doesn't exist, create it with basic frontmatter
  if (!fs.existsSync(topicFile)) {
    const content = `---
title: ${topicId}
status: ${newStatus}
category: general
created: ${new Date().toISOString().split("T")[0]}
---

# ${topicId}

## Overview
*Topic tracking file.*

## Notes
`;
    fs.writeFileSync(topicFile, content, "utf8");
    return {
      topic: {
        id: topicId,
        name: topicId,
        title: topicId,
        status: newStatus,
      },
    };
  }

  // Read existing topic.md
  let content = fs.readFileSync(topicFile, "utf8");
  let title = topicId;

  // Check if it has YAML frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

  if (frontmatterMatch) {
    // Has frontmatter - update status field
    let frontmatter = frontmatterMatch[1];

    // Extract title if present
    const titleMatch = frontmatter.match(/title:\s*["']?([^"'\n]+)["']?/i);
    if (titleMatch) title = titleMatch[1];

    if (frontmatter.includes("status:")) {
      // Replace existing status
      frontmatter = frontmatter.replace(
        /status:\s*(active|resolved|parked)/i,
        `status: ${newStatus}`,
      );
    } else {
      // Add status field
      frontmatter = frontmatter.trim() + `\nstatus: ${newStatus}`;
    }

    content = content.replace(/^---\n[\s\S]*?\n---/, `---\n${frontmatter}\n---`);
  } else {
    // No frontmatter - add one
    const headerMatch = content.match(/^#\s*(.+)/m);
    if (headerMatch) title = headerMatch[1];

    const frontmatter = `---
title: ${title}
status: ${newStatus}
category: general
created: ${new Date().toISOString().split("T")[0]}
---

`;
    content = frontmatter + content;
  }

  // Write updated content
  fs.writeFileSync(topicFile, content, "utf8");

  return {
    topic: {
      id: topicId,
      name: topicId,
      title: title,
      status: newStatus,
    },
  };
}

module.exports = {
  getCerebroTopics,
  updateTopicStatus,
};
