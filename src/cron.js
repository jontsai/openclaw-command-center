const fs = require("fs");
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

// Get cron jobs - reads directly from file for speed (CLI takes 11s+)
function getCronJobs(getOpenClawDir) {
  try {
    const cronPath = path.join(getOpenClawDir(), "cron", "jobs.json");
    if (fs.existsSync(cronPath)) {
      const data = JSON.parse(fs.readFileSync(cronPath, "utf8"));
      return (data.jobs || []).map((j) => {
        // Parse schedule
        let scheduleStr = "—";
        let scheduleHuman = null;
        if (j.schedule) {
          if (j.schedule.kind === "cron" && j.schedule.expr) {
            scheduleStr = j.schedule.expr;
            scheduleHuman = cronToHuman(j.schedule.expr);
          } else if (j.schedule.kind === "once") {
            scheduleStr = "once";
            scheduleHuman = "One-time";
          }
        }

        // Format next run
        let nextRunStr = "—";
        if (j.state?.nextRunAtMs) {
          const next = new Date(j.state.nextRunAtMs);
          const now = new Date();
          const diffMs = next - now;
          const diffMins = Math.round(diffMs / 60000);
          if (diffMins < 0) {
            nextRunStr = "overdue";
          } else if (diffMins < 60) {
            nextRunStr = `${diffMins}m`;
          } else if (diffMins < 1440) {
            nextRunStr = `${Math.round(diffMins / 60)}h`;
          } else {
            nextRunStr = `${Math.round(diffMins / 1440)}d`;
          }
        }

        return {
          id: j.id,
          name: j.name || j.id.slice(0, 8),
          schedule: scheduleStr,
          scheduleHuman: scheduleHuman,
          nextRun: nextRunStr,
          enabled: j.enabled !== false,
          lastStatus: j.state?.lastStatus,
        };
      });
    }
  } catch (e) {
    console.error("Failed to get cron:", e.message);
  }
  return [];
}

module.exports = {
  cronToHuman,
  getCronJobs,
};
