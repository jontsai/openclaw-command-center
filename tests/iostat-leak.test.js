const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const { spawn, execSync } = require("child_process");
const os = require("os");
const path = require("path");

const isLinux = os.platform() === "linux";

/**
 * Count running iostat processes using pgrep (avoids self-match issues with ps|grep).
 * Returns 0 if pgrep finds no matches (exit code 1).
 */
function countIostatProcesses() {
  try {
    return parseInt(execSync("pgrep -c iostat", { encoding: "utf8" }).trim(), 10) || 0;
  } catch {
    return 0; // pgrep exits 1 when no matches
  }
}

/**
 * Simple HTTP GET helper that returns a promise
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body,
          }),
        );
      })
      .on("error", reject);
  });
}

describe(
  "iostat resource leak (#31)",
  { skip: !isLinux && "Linux-only test", timeout: 90000 },
  () => {
    const TEST_PORT = 10000 + Math.floor(Math.random() * 50000);
    let serverProcess;

    before(async () => {
      // Kill any stale iostat processes from prior runs
      try {
        execSync("pkill iostat 2>/dev/null", { encoding: "utf8" });
      } catch {
        // No stale processes — expected
      }

      // Start the server
      serverProcess = spawn(process.execPath, [path.join(__dirname, "..", "lib", "server.js")], {
        env: { ...process.env, PORT: String(TEST_PORT) },
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Wait for server to be ready by polling the health endpoint
      const maxWait = 15000;
      const start = Date.now();

      while (Date.now() - start < maxWait) {
        try {
          await httpGet(`http://localhost:${TEST_PORT}/api/health`);
          return; // Server is ready
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }

      throw new Error(`Server did not start within ${maxWait}ms`);
    });

    after(() => {
      if (serverProcess) {
        serverProcess.kill("SIGTERM");
        serverProcess = null;
      }
    });

    it("does not accumulate iostat processes over multiple vitals refreshes", async () => {
      // Vitals refresh every 30s (plus once at startup). Wait long enough for
      // at least two cycles, then sample multiple times to catch the peak count.
      // With the fix, each iostat exits in ~1s so we should never see more than
      // 1 running at a time. Without the fix, each cycle spawns an immortal
      // process and the count grows unboundedly.
      await new Promise((resolve) => setTimeout(resolve, 35000));

      // Sample several times over 5s to get a reliable peak
      let peak = 0;
      for (let i = 0; i < 5; i++) {
        peak = Math.max(peak, countIostatProcesses());
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // At most 2 concurrent: one finishing from a prior cycle, one just started
      assert.ok(peak <= 2, `Peak iostat process count was ${peak} — leak detected`);
    });

    it("leaves no orphaned iostat processes after shutdown", async () => {
      // Snapshot before shutdown (other test suites may also have servers running
      // that spawn iostat, so we compare relative to this baseline)
      const baseline = countIostatProcesses();

      // Kill the server
      if (serverProcess) {
        serverProcess.kill("SIGTERM");
        serverProcess = null;
      }

      // Give processes time to clean up (iostat -d 1 2 takes ~1s, plus timeout margin)
      await new Promise((resolve) => setTimeout(resolve, 6000));

      const remaining = countIostatProcesses();
      assert.ok(
        remaining <= baseline,
        `iostat count grew after shutdown: ${baseline} before, ${remaining} after`,
      );
    });
  },
);
