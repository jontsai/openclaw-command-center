/**
 * Utility functions shared across modules
 */

const { exec } = require("child_process");
const path = require("path");
const { promisify } = require("util");
const execAsync = promisify(exec);

const pkg = require(path.join(__dirname, "..", "package.json"));

function getVersion() {
  return pkg.version;
}

/**
 * Run a shell command with sensible defaults
 * @param {string} cmd - Command to execute
 * @param {object} options - Options (timeout, fallback, etc.)
 * @returns {Promise<string>} - Command output
 */
async function runCmd(cmd, options = {}) {
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

function formatBytes(bytes) {
  if (bytes >= 1099511627776) return (bytes / 1099511627776).toFixed(1) + " TB";
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + " GB";
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
}

function formatTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.round(diffMins / 60)}h ago`;
  return `${Math.round(diffMins / 1440)}d ago`;
}

function formatNumber(n) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return n.toString();
}

module.exports = {
  getVersion,
  runCmd,
  formatBytes,
  formatTimeAgo,
  formatNumber,
  formatTokens,
};
