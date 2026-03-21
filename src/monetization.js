const fs = require("fs");
const path = require("path");

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

      // Detect table header — supports Czech ("Firma") and English ("Company", "Firm")
      if (
        line.startsWith("|") &&
        (line.includes("Firma") || line.includes("Company") || line.includes("Firm")) &&
        !inTable
      ) {
        const cells = line
          .split("|")
          .map((c) => c.trim())
          .filter((c) => c.length > 0);

        // Next line should be separator
        const nextLine = (lines[i + 1] || "").trim();
        if (nextLine.match(/^\|[\s-:|]+\|$/)) {
          headers = cells;
          inTable = true;
          i++; // Skip separator
          continue;
        }
      }

      // Parse table rows
      if (inTable && line.startsWith("|")) {
        const cells = line
          .split("|")
          .map((c) => c.trim())
          .filter((c) => c.length > 0);

        if (cells.length < 4) continue;

        // Use parsed headers for column lookup (resilient to column reordering)
        const colIdx = (name) => {
          const idx = headers.findIndex((h) => h.toLowerCase().includes(name.toLowerCase()));
          return idx >= 0 ? idx : -1;
        };
        const nameIdx =
          colIdx("Firma") >= 0
            ? colIdx("Firma")
            : colIdx("Company") >= 0
              ? colIdx("Company")
              : colIdx("Firm");
        const revenueIdx = colIdx("Revenue");
        const milestoneIdx = colIdx("Milestone");
        const blockerIdx = colIdx("Blocker");
        const priorityIdx = colIdx("Priority");

        const firm = {
          name: (nameIdx >= 0 ? cells[nameIdx] : cells[1] || "").replace(/\*\*/g, "").trim(),
          revenue: (revenueIdx >= 0 ? cells[revenueIdx] : cells[2] || "").trim(),
          milestone: (milestoneIdx >= 0 ? cells[milestoneIdx] : cells[3] || "").trim(),
          blocker: (blockerIdx >= 0 ? cells[blockerIdx] : cells[4] || "").trim(),
          priority: (priorityIdx >= 0 ? cells[priorityIdx] : cells[5] || "")
            .replace(/\*\*/g, "")
            .trim()
            .toUpperCase(),
        };

        if (!firm.name || firm.name === "-") continue;

        result.firms.push(firm);

        // Count priority
        if (firm.priority === "HIGH") result.highPriority++;

        // Check for revenue (any non-$0 value)
        if (firm.revenue && !firm.revenue.includes("$0")) {
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
