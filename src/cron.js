const fs = require("fs");
const { stripVTControlCharacters } = require("node:util");
const path = require("path");

// Convert cron expression to human-readable text
function cronToHuman(expr) {
  if (!expr || expr === "—") return null;

  const parts = expr.split(" ");
  if (parts.length < 5) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Helper to format time
  function formatTime(h, m) {
    const hNum = parseInt(h, 10);
    const mNum = parseInt(m, 10);
    if (isNaN(hNum)) return null;
    const ampm = hNum >= 12 ? "pm" : "am";
    const h12 = hNum === 0 ? 12 : hNum > 12 ? hNum - 12 : hNum;
    return mNum === 0 ? `${h12}${ampm}` : `${h12}:${mNum.toString().padStart(2, "0")}${ampm}`;
  }

  // Every minute
  if (minute === "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return "Every minute";
  }

  // Every X minutes
  if (minute.startsWith("*/")) {
    const interval = minute.slice(2);
    return `Every ${interval} minutes`;
  }

  // Every X hours (*/N in hour field)
  if (hour.startsWith("*/")) {
    const interval = hour.slice(2);
    const minStr = minute === "0" ? "" : `:${minute.padStart(2, "0")}`;
    return `Every ${interval} hours${minStr ? " at " + minStr : ""}`;
  }

  // Every hour at specific minute
  if (minute !== "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Hourly at :${minute.padStart(2, "0")}`;
  }

  // Build time string for specific hour
  let timeStr = "";
  if (minute !== "*" && hour !== "*" && !hour.startsWith("*/")) {
    timeStr = formatTime(hour, minute);
  }

  // Daily at specific time
  if (timeStr && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Daily at ${timeStr}`;
  }

  // Weekdays (Mon-Fri) - check before generic day of week
  if ((dayOfWeek === "1-5" || dayOfWeek === "MON-FRI") && dayOfMonth === "*" && month === "*") {
    return timeStr ? `Weekdays at ${timeStr}` : "Weekdays";
  }

  // Weekends - check before generic day of week
  if ((dayOfWeek === "0,6" || dayOfWeek === "6,0") && dayOfMonth === "*" && month === "*") {
    return timeStr ? `Weekends at ${timeStr}` : "Weekends";
  }

  // Specific day of week
  if (dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
    const days = dayOfWeek.split(",").map((d) => {
      const num = parseInt(d, 10);
      return dayNames[num] || d;
    });
    const dayStr = days.length === 1 ? days[0] : days.join(", ");
    return timeStr ? `${dayStr} at ${timeStr}` : `Every ${dayStr}`;
  }

  // Specific day of month
  if (dayOfMonth !== "*" && month === "*" && dayOfWeek === "*") {
    const day = parseInt(dayOfMonth, 10);
    const suffix =
      day === 1 || day === 21 || day === 31
        ? "st"
        : day === 2 || day === 22
          ? "nd"
          : day === 3 || day === 23
            ? "rd"
            : "th";
    return timeStr ? `${day}${suffix} of month at ${timeStr}` : `${day}${suffix} of every month`;
  }

  // Fallback: just show the time if we have it
  if (timeStr) {
    return `At ${timeStr}`;
  }

  return expr; // Return original as fallback
}

// Normalize only display fields; never return automation prompts or delivery config.
function normalizeJobs(jobs) {
  return jobs.map((j) => {
    if (!j || typeof j.id !== "string") throw new Error("invalid_cron_job");
    const schedule = j.schedule || {};
    let scheduleStr = "—",
      scheduleHuman = null;
    if (schedule.kind === "cron" && typeof schedule.expr === "string") {
      scheduleStr = schedule.expr;
      scheduleHuman = cronToHuman(schedule.expr);
    } else if (["once", "at"].includes(schedule.kind)) {
      scheduleStr = "once";
      scheduleHuman = "One-time";
    } else if (schedule.kind === "every" && Number.isFinite(schedule.everyMs)) {
      scheduleStr = `every ${schedule.everyMs / 1000}s`;
    }
    const nextMs = j.nextRunAtMs ?? j.state?.nextRunAtMs;
    let nextRun = "—";
    if (Number.isFinite(nextMs)) {
      const mins = Math.round((nextMs - Date.now()) / 60000);
      nextRun =
        mins < 0
          ? "overdue"
          : mins < 60
            ? `${mins}m`
            : mins < 1440
              ? `${Math.round(mins / 60)}h`
              : `${Math.round(mins / 1440)}d`;
    }
    return {
      id: j.id,
      name: typeof j.name === "string" ? j.name : j.id.slice(0, 8),
      schedule: scheduleStr,
      scheduleHuman,
      nextRun,
      enabled: j.enabled !== false,
      lastStatus: j.lastRunStatus ?? j.state?.lastStatus,
    };
  });
}

// Legacy helper retained for callers that explicitly use a JSON store.
function getCronJobs(getOpenClawDir) {
  try {
    const file = path.join(getOpenClawDir(), "cron", "jobs.json");
    if (fs.existsSync(file))
      return normalizeJobs(JSON.parse(fs.readFileSync(file, "utf8")).jobs || []);
  } catch {
    /* unavailable, not an authoritative empty catalog */
  }
  return [];
}

function createCronHost({ run, now = Date.now, refreshMs = 30000 }) {
  let snapshot = { jobs: [], status: "loading", observedAt: null },
    pending = null,
    nextCheck = 0;
  function refresh() {
    if (pending) return pending;
    nextCheck = now() + refreshMs;
    pending = Promise.resolve()
      .then(async () => {
        try {
          const raw = await run(
            ["cron", "list", "--agent", "main", "--all", "--json", "--timeout", "5000"],
            { timeout: 8000 },
          );
          if (typeof raw !== "string" || Buffer.byteLength(raw) > 4 * 1024 * 1024)
            throw new Error("invalid_cron_catalog");
          const data = JSON.parse(stripVTControlCharacters(raw).trim());
          if (!Array.isArray(data.jobs) || data.jobs.length > 1000)
            throw new Error("invalid_cron_catalog");
          snapshot = {
            jobs: normalizeJobs(data.jobs),
            status: data.hasMore || data.total > data.jobs.length ? "partial" : "available",
            observedAt: now(),
          };
        } catch {
          snapshot = {
            ...snapshot,
            status: snapshot.observedAt === null ? "unavailable" : "stale",
          };
        }
        return snapshot;
      })
      .finally(() => {
        pending = null;
        nextCheck = now() + refreshMs;
      });
    return pending;
  }
  function getState() {
    if (now() >= nextCheck && !pending) void refresh();
    return snapshot;
  }
  return { getState, refresh };
}
module.exports = { cronToHuman, getCronJobs, normalizeJobs, createCronHost };
