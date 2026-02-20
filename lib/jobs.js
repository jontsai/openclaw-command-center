/**
 * Jobs Dashboard API Handler
 *
 * Wraps the jobs API for the dashboard server.
 * Uses dynamic imports to bridge CommonJS server with ESM jobs modules.
 */

const path = require("path");
const { CONFIG } = require("./config");

// Jobs directory (from config with auto-detection)
const JOBS_DIR = CONFIG.paths.jobs;
const JOBS_STATE_DIR = path.join(CONFIG.paths.state, "jobs");

let apiInstance = null;
let forceApiUnavailable = false; // For testing

/**
 * Initialize the jobs API (lazy-loaded due to ESM)
 */
async function getAPI() {
  if (forceApiUnavailable) return null;
  if (apiInstance) return apiInstance;

  try {
    const { createJobsAPI } = await import(path.join(JOBS_DIR, "lib/api.js"));
    apiInstance = createJobsAPI({
      definitionsDir: path.join(JOBS_DIR, "definitions"),
      stateDir: JOBS_STATE_DIR,
    });
    return apiInstance;
  } catch (e) {
    console.error("Failed to load jobs API:", e.message);
    return null;
  }
}

/**
 * Reset API state for testing purposes
 * @param {Object} options - Reset options
 * @param {boolean} options.forceUnavailable - If true, getAPI() will return null
 */
function _resetForTesting(options = {}) {
  apiInstance = null;
  forceApiUnavailable = options.forceUnavailable || false;
}

/**
 * Format relative time
 */
function formatRelativeTime(isoString) {
  if (!isoString) return null;
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.round(diffMs / 60000);

  if (diffMins < 0) {
    const futureMins = Math.abs(diffMins);
    if (futureMins < 60) return `in ${futureMins}m`;
    if (futureMins < 1440) return `in ${Math.round(futureMins / 60)}h`;
    return `in ${Math.round(futureMins / 1440)}d`;
  }

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.round(diffMins / 60)}h ago`;
  return `${Math.round(diffMins / 1440)}d ago`;
}

/**
 * Handle jobs API requests
 */
async function handleJobsRequest(req, res, pathname, query, method) {
  const api = await getAPI();

  if (!api) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Jobs API not available" }));
    return;
  }

  try {
    // Scheduler status: GET /api/jobs/scheduler/status (before single job route)
    if (pathname === "/api/jobs/scheduler/status" && method === "GET") {
      const status = await api.getSchedulerStatus();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(status, null, 2));
      return;
    }

    // Aggregate stats: GET /api/jobs/stats (before single job route)
    if (pathname === "/api/jobs/stats" && method === "GET") {
      const stats = await api.getAggregateStats();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(stats, null, 2));
      return;
    }

    // Clear cache: POST /api/jobs/cache/clear (before single job route)
    if (pathname === "/api/jobs/cache/clear" && method === "POST") {
      api.clearCache();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, message: "Cache cleared" }));
      return;
    }

    // List all jobs: GET /api/jobs
    if (pathname === "/api/jobs" && method === "GET") {
      const jobs = await api.listJobs();

      // Enhance with relative times
      const enhanced = jobs.map((job) => ({
        ...job,
        lastRunRelative: formatRelativeTime(job.lastRun),
        nextRunRelative: formatRelativeTime(job.nextRun),
      }));

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jobs: enhanced, timestamp: Date.now() }, null, 2));
      return;
    }

    // Get single job: GET /api/jobs/:id
    const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobMatch && method === "GET") {
      const jobId = decodeURIComponent(jobMatch[1]);
      const job = await api.getJob(jobId);

      if (!job) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Job not found" }));
        return;
      }

      // Enhance with relative times
      job.lastRunRelative = formatRelativeTime(job.lastRun);
      job.nextRunRelative = formatRelativeTime(job.nextRun);
      if (job.recentRuns) {
        job.recentRuns = job.recentRuns.map((run) => ({
          ...run,
          startedAtRelative: formatRelativeTime(run.startedAt),
          completedAtRelative: formatRelativeTime(run.completedAt),
        }));
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(job, null, 2));
      return;
    }

    // Get job history: GET /api/jobs/:id/history
    const historyMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/history$/);
    if (historyMatch && method === "GET") {
      const jobId = decodeURIComponent(historyMatch[1]);
      const limit = parseInt(query.get("limit") || "50", 10);
      const runs = await api.getJobHistory(jobId, limit);

      const enhanced = runs.map((run) => ({
        ...run,
        startedAtRelative: formatRelativeTime(run.startedAt),
        completedAtRelative: formatRelativeTime(run.completedAt),
      }));

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ runs: enhanced, timestamp: Date.now() }, null, 2));
      return;
    }

    // Run job: POST /api/jobs/:id/run
    const runMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/run$/);
    if (runMatch && method === "POST") {
      const jobId = decodeURIComponent(runMatch[1]);
      const result = await api.runJob(jobId);

      res.writeHead(result.success ? 200 : 400, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result, null, 2));
      return;
    }

    // Pause job: POST /api/jobs/:id/pause
    const pauseMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/pause$/);
    if (pauseMatch && method === "POST") {
      const jobId = decodeURIComponent(pauseMatch[1]);

      // Parse body for reason
      let body = "";
      await new Promise((resolve) => {
        req.on("data", (chunk) => (body += chunk));
        req.on("end", resolve);
      });

      let reason = null;
      try {
        const parsed = JSON.parse(body || "{}");
        reason = parsed.reason;
      } catch (_e) {
        /* ignore parse errors */
      }

      const result = await api.pauseJob(jobId, {
        by: req.authUser?.login || "dashboard",
        reason,
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result, null, 2));
      return;
    }

    // Resume job: POST /api/jobs/:id/resume
    const resumeMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/resume$/);
    if (resumeMatch && method === "POST") {
      const jobId = decodeURIComponent(resumeMatch[1]);
      const result = await api.resumeJob(jobId);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result, null, 2));
      return;
    }

    // Skip job: POST /api/jobs/:id/skip
    const skipMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/skip$/);
    if (skipMatch && method === "POST") {
      const jobId = decodeURIComponent(skipMatch[1]);
      const result = await api.skipJob(jobId);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result, null, 2));
      return;
    }

    // Kill job: POST /api/jobs/:id/kill
    const killMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/kill$/);
    if (killMatch && method === "POST") {
      const jobId = decodeURIComponent(killMatch[1]);
      const result = await api.killJob(jobId);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result, null, 2));
      return;
    }

    // Not found
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (e) {
    console.error("Jobs API error:", e);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
}

/**
 * Check if a request should be handled by jobs API
 */
function isJobsRoute(pathname) {
  return pathname.startsWith("/api/jobs");
}

module.exports = { handleJobsRequest, isJobsRoute, _resetForTesting };
