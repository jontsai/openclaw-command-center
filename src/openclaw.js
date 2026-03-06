/**
 * OpenClaw CLI helpers - wrappers for running openclaw commands
 */

const { execSync, exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);

/**
 * Run openclaw CLI command synchronously
 * @param {string} args - Command arguments
 * @returns {string|null} - Command output or null on error
 */
function runOpenClaw(args) {
  const profile = process.env.OPENCLAW_PROFILE || "";
  const profileFlag = profile ? ` --profile ${profile}` : "";
  try {
    const result = execSync(`openclaw${profileFlag} ${args}`, {
      encoding: "utf8",
      timeout: 3000, // 3 second timeout - don't block server
      env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
      stdio: ["pipe", "pipe", "pipe"], // Capture all output
    });
    return result;
  } catch (e) {
    return null;
  }
}

/**
 * Run openclaw CLI command asynchronously
 * @param {string} args - Command arguments
 * @returns {Promise<string|null>} - Command output or null on error
 */
async function runOpenClawAsync(args) {
  const profile = process.env.OPENCLAW_PROFILE || "";
  const profileFlag = profile ? ` --profile ${profile}` : "";
  try {
    const { stdout } = await execAsync(`openclaw${profileFlag} ${args}`, {
      encoding: "utf8",
      timeout: 20000, // 20s timeout: openclaw status/sessions can be slow under load
      env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
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
};
