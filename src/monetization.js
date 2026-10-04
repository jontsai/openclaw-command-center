const fs = require("fs");
const path = require("path");
const { splitTableRow, isTableSeparator } = require("./markdown-table");

// Count only explicit positive amounts, not prose such as "pending" or "100 prospects".
// Supports decimal amounts, comma thousands, common currency labels, and /mo or /yr.
function hasPositiveRevenue(value) {
  const amount = value.replace(/\*\*/g, "").trim();
  const match = amount.match(
    /^(?:(?:[$€£]|USD|EUR|GBP|CZK|KČ)\s*)?([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(?:USD|EUR|GBP|CZK|KČ)?(?:\s*\/(?:mo|month|yr|year))?$/i,
  );
  return !!match && Number(match[1].replace(/,/g, "")) > 0;
}

/**
 * Monetization Tracker Module
 * Reads intel/MONETIZATION-TRACKER.md and parses the firms table.
 */
function createMonetizationModule(deps) {
  const { CONFIG } = deps;

  function getMonetizationStats() {
    const trackerPath = path.join(CONFIG.paths.workspace, "intel", "MONETIZATION-TRACKER.md");

    const result = {
      firms: [],
      totalFirms: 0,
      highPriority: 0,
      revenueFirms: 0,
    };

    if (!fs.existsSync(trackerPath)) {
      return result;
    }

    let content;
    try {
      content = fs.readFileSync(trackerPath, "utf8");
    } catch (e) {
      return result;
    }

    // Parse the markdown table
    const lines = content.split("\n");
    let headers = [];
    let inTable = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      const cells = splitTableRow(line);
      if (!inTable && cells.length) {
        const normalizedHeaders = cells.map((cell) =>
          cell.replace(/\*\*/g, "").trim().toLowerCase(),
        );
        if (
          normalizedHeaders.some((header) => ["firma", "company", "firm"].includes(header)) &&
          isTableSeparator(lines[i + 1] || "", cells.length)
        ) {
          headers = normalizedHeaders;
          inTable = true;
          i++;
          continue;
        }
      }

      if (inTable && cells.length) {
        // Missing optional columns and truncated rows remain empty, never shift left.
        const column = (...names) => {
          const index = headers.findIndex((header) => names.includes(header));
          return (cells[index] || "").trim();
        };
        const firm = {
          name: column("firma", "company", "firm").replace(/\*\*/g, "").trim(),
          revenue: column("revenue"),
          milestone: column("milestone"),
          blocker: column("blocker"),
          priority: column("priority").replace(/\*\*/g, "").trim().toUpperCase(),
        };

        if (!firm.name || firm.name === "-") continue;

        result.firms.push(firm);

        // Count priority
        if (firm.priority === "HIGH") result.highPriority++;

        // Check for an explicit positive revenue amount
        if (hasPositiveRevenue(firm.revenue)) {
          result.revenueFirms++;
        }
      } else if (inTable && !line.startsWith("|")) {
        inTable = false;
      }
    }

    result.totalFirms = result.firms.length;

    return result;
  }

  return { getMonetizationStats };
}

module.exports = { createMonetizationModule };
