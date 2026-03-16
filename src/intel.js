const fs = require("fs");
const path = require("path");

/**
 * Intel Pipeline Module
 * Reads intel/ directory and provides freshness stats for each file.
 */
function createIntelModule(deps) {
  const { CONFIG } = deps;

  const SIX_HOURS = 6 * 60 * 60 * 1000;
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  function getFreshness(ageMs) {
    if (ageMs < SIX_HOURS) return "fresh";
    if (ageMs < TWENTY_FOUR_HOURS) return "aging";
    return "stale";
  }

  function getIntelStats() {
    const intelDir = path.join(CONFIG.paths.workspace, "intel");
    const now = Date.now();

    const result = {
      totalFiles: 0,
      freshCount: 0,
      agingCount: 0,
      staleCount: 0,
      files: [],
      assignments: {},
    };

    if (!fs.existsSync(intelDir)) {
      return result;
    }

    const entries = fs.readdirSync(intelDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

      const filePath = path.join(intelDir, entry.name);
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch (e) {
        continue;
      }

      const ageMs = now - stat.mtimeMs;
      const freshness = getFreshness(ageMs);

      // Parse first 10 lines looking for Agent: header
      let agent = null;
      try {
        const fd = fs.openSync(filePath, "r");
        const buffer = Buffer.alloc(1024);
        const bytesRead = fs.readSync(fd, buffer, 0, 1024, 0);
        fs.closeSync(fd);
        const head = buffer.toString("utf8", 0, bytesRead);
        const lines = head.split("\n").slice(0, 10);
        for (const line of lines) {
          const match = line.match(/(?:\*\*)?Agent(?:\*\*)?:\s*(.+)/i);
          if (match) {
            agent = match[1]
              .replace(/\*\*/g, "")
              .replace(/\s*[|(].*$/, "")
              .trim();
            break;
          }
          // Also check for "Zpracoval:" (Czech variant)
          const matchCz = line.match(/(?:\*\*)?Zpracoval(?:\*\*)?:\s*(.+)/i);
          if (matchCz) {
            agent = matchCz[1]
              .replace(/\*\*/g, "")
              .replace(/\s*[|(].*$/, "")
              .trim();
            break;
          }
          // Also check for "Autor:" (Czech variant)
          const matchAutor = line.match(/(?:\*\*)?Autor(?:\*\*)?:\s*(.+)/i);
          if (matchAutor) {
            agent = matchAutor[1].replace(/\*\*/g, "").replace(/,.*/, "").trim();
            break;
          }
        }
      } catch (e) {
        // Skip parse errors
      }

      const fileInfo = {
        name: entry.name,
        agent: agent || "Unknown",
        modified: stat.mtime.toISOString(),
        ageMs,
        freshness,
      };

      result.files.push(fileInfo);

      // Count freshness
      if (freshness === "fresh") result.freshCount++;
      else if (freshness === "aging") result.agingCount++;
      else result.staleCount++;

      // Track agent assignments
      const agentKey = fileInfo.agent;
      result.assignments[agentKey] = (result.assignments[agentKey] || 0) + 1;
    }

    result.totalFiles = result.files.length;

    // Sort files by modification time (newest first)
    result.files.sort((a, b) => a.ageMs - b.ageMs);

    return result;
  }

  return { getIntelStats };
}

module.exports = { createIntelModule };
