/**
 * Utility functions for OpenClaw Command Center
 */

const { exec } = require("child_process");
const { promisify } = require("util");

const execAsync = promisify(exec);

/**
 * Run command and return stdout (with timeout and error handling)
 */
async function runCmd(cmd, options = {}) {
  // Ensure standard system paths are available (LaunchAgent/cron may have minimal PATH)
  const systemPath = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  const envPath = process.env.PATH || "";
  const opts = {
    encoding: "utf8",
    timeout: 10000,
    env: {
      ...process.env,
      PATH: envPath.includes("/usr/sbin") ? envPath : `${systemPath}:${envPath}`,
    },
    ...options,
  };
  try {
    const { stdout } = await execAsync(cmd, opts);
    return stdout.trim();
  } catch (e) {
    if (options.fallback !== undefined) return options.fallback;
    throw e;
  }
}

/**
 * Format bytes as human-readable string
 */
function formatBytes(bytes) {
  if (bytes >= 1099511627776) return (bytes / 1099511627776).toFixed(1) + " TB";
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + " GB";
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
}

/**
 * Format date as relative time ago
 */
function formatTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.round(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.round(diffMins / 60)}h ago`;
  return `${Math.round(diffMins / 1440)}d ago`;
}

/**
 * Format number with locale-aware decimal places
 */
function formatNumber(n) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Format token count as human-readable string
 */
function formatTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return n.toString();
}

module.exports = {
  runCmd,
  formatBytes,
  formatTimeAgo,
  formatNumber,
  formatTokens,
};
