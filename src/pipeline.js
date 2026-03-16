const fs = require("fs");
const path = require("path");

/**
 * Pipeline Viewer Module
 * Reads intel/ directory for *-PIPELINE.md and *-QUEUE.md files,
 * parses markdown tables to extract pipeline status data.
 */
function createPipelineModule(deps) {
  const { CONFIG } = deps;

  /**
   * Parse a markdown table into rows of objects.
   * Returns array of objects with lowercase keys from header row.
   */
  function parseMarkdownTable(content) {
    const lines = content.split("\n");
    const tables = [];
    let headerLine = null;
    let headers = [];
    let inTable = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Detect table header (line with | separators)
      if (line.startsWith("|") && line.includes("|") && !inTable) {
        const cells = line
          .split("|")
          .map((c) => c.trim())
          .filter((c) => c.length > 0);

        // Next line should be separator (|---|---|)
        const nextLine = (lines[i + 1] || "").trim();
        if (nextLine.match(/^\|[\s-:|]+\|$/)) {
          headerLine = line;
          headers = cells.map((c) => c.toLowerCase().replace(/[^a-z0-9]/g, "_"));
          inTable = true;
          i++; // Skip separator line
          continue;
        }
      }

      // Parse table rows
      if (inTable && line.startsWith("|")) {
        const cells = line
          .split("|")
          .map((c) => c.trim())
          .filter((c) => c.length > 0);

        if (cells.length >= 2) {
          const row = {};
          headers.forEach((h, idx) => {
            row[h] = cells[idx] || "";
          });
          tables.push(row);
        }
      } else if (inTable && !line.startsWith("|")) {
        inTable = false;
      }
    }

    return tables;
  }

  function getPipelineStats() {
    const intelDir = path.join(CONFIG.paths.workspace, "intel");
    const result = {
      pipelines: [],
    };

    if (!fs.existsSync(intelDir)) {
      return result;
    }

    const entries = fs.readdirSync(intelDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".md")) continue;

      // Match *-PIPELINE.md or *-QUEUE.md (case insensitive)
      const nameUpper = entry.name.toUpperCase();
      if (!nameUpper.includes("PIPELINE") && !nameUpper.includes("QUEUE")) continue;

      const filePath = path.join(intelDir, entry.name);
      let content;
      try {
        content = fs.readFileSync(filePath, "utf8");
      } catch (e) {
        continue;
      }

      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch (e) {
        continue;
      }

      const rows = parseMarkdownTable(content);
      const totalItems = rows.length;

      // Count statuses - look for "status" column or detect status-like values
      const statusCounts = {};
      for (const row of rows) {
        // Try common status column names
        const statusValue = row.status || row.email_odesl_n_ || row.stav || "";

        if (statusValue) {
          // Normalize status values
          const normalized = statusValue.replace(/[*_]/g, "").trim().toUpperCase();
          if (normalized && normalized !== "-") {
            statusCounts[normalized] = (statusCounts[normalized] || 0) + 1;
          }
        }
      }

      // Derive a clean name from the filename
      const name = entry.name
        .replace(/\.md$/i, "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      result.pipelines.push({
        name,
        file: entry.name,
        totalItems,
        statusCounts,
        lastModified: stat.mtime.toISOString(),
      });
    }

    // Sort by last modified (newest first)
    result.pipelines.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

    return result;
  }

  return { getPipelineStats };
}

module.exports = { createPipelineModule };
