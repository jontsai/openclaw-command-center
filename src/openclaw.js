/**
 * OpenClaw CLI helpers - wrappers for running openclaw commands
 */

const { execFileSync, execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

/**
 * Build a minimal env for child processes.
 * Avoids leaking secrets (API keys, cloud creds) to shell subprocesses.
 */
function getSafeEnv() {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    SHELL: process.env.SHELL,
    LANG: process.env.LANG,
    NO_COLOR: "1",
    TERM: "dumb",
    OPENCLAW_PROFILE: process.env.OPENCLAW_PROFILE || "",
    OPENCLAW_WORKSPACE: process.env.OPENCLAW_WORKSPACE || "",
    OPENCLAW_HOME: process.env.OPENCLAW_HOME || "",
  };
}

/**
 * Build args array for openclaw CLI, prepending --profile if set.
 * Splits the args string on whitespace (shell-injection-safe since
 * execFileSync never invokes a shell).
 */
function buildArgs(args) {
  const profile = process.env.OPENCLAW_PROFILE || "";
  const profileArgs = profile ? ["--profile", profile] : [];
  // Strip shell redirections (e.g. "2>&1", "2>/dev/null") — not needed with execFile
  const cleanArgs = args
    .replace(/\s*2>&1\s*/g, " ")
    .replace(/\s*2>\/dev\/null\s*/g, " ")
    .trim();
  return [...profileArgs, ...cleanArgs.split(/\s+/).filter(Boolean)];
}

/**
 * Run openclaw CLI command synchronously
 * Uses execFileSync (no shell) to eliminate injection surface.
 * @param {string} args - Command arguments
 * @returns {string|null} - Command output or null on error
 */
function runOpenClaw(args) {
  try {
    const result = execFileSync("openclaw", buildArgs(args), {
      encoding: "utf8",
      timeout: 3000,
      env: getSafeEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result;
  } catch (e) {
    return null;
  }
}

/**
 * Run openclaw CLI command asynchronously
 * Uses execFile (no shell) to eliminate injection surface.
 * @param {string} args - Command arguments
 * @returns {Promise<string|null>} - Command output or null on error
 */
async function runOpenClawAsync(args) {
  try {
    const { stdout } = await execFileAsync("openclaw", buildArgs(args), {
      encoding: "utf8",
      timeout: 20000,
      env: getSafeEnv(),
    });
    return stdout;
  } catch (e) {
    console.error("[OpenClaw Async] Error:", e.message);
    return null;
  }
}

/**
 * Extract JSON from openclaw output (may have non-JSON prefix)
 * @param {string} output - Raw CLI output
 * @returns {string|null} - JSON string or null
 */
function extractJSON(output) {
  if (!output) return null;
  const jsonStart = output.search(/[[{]/);
  if (jsonStart === -1) return null;
  return output.slice(jsonStart);
}

module.exports = {
  runOpenClaw,
  runOpenClawAsync,
  extractJSON,
  getSafeEnv,
};
