/**
 * OpenClaw CLI helpers for Command Center
 * Provides sync and async wrappers for running openclaw commands
 */

const { execSync, exec } = require("child_process");
const { promisify } = require("util");

const execAsync = promisify(exec);

/**
 * Run openclaw command synchronously (blocking)
 * Use sparingly - prefer runOpenClawAsync for non-blocking operations
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
    // Don't log every failure - these are expected when CLI is slow
    return null;
  }
}

/**
 * Run openclaw command asynchronously (non-blocking)
 * Preferred method for most operations
 */
async function runOpenClawAsync(args) {
  const profile = process.env.OPENCLAW_PROFILE || "";
  const profileFlag = profile ? ` --profile ${profile}` : "";
  try {
    const { stdout } = await execAsync(`openclaw${profileFlag} ${args}`, {
      encoding: "utf8",
      timeout: 10000, // 10 second timeout for async
      env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
    });
    return stdout;
  } catch (e) {
    console.error("[OpenClaw Async] Error:", e.message);
    return null;
  }
}

/**
 * Extract JSON from CLI output that may contain doctor warnings or other prefix text
 */
function extractJSON(output) {
  if (!output) return null;
  // Find the first { or [ which starts the JSON
  const jsonStart = output.search(/[[{]/);
  if (jsonStart === -1) return null;
  return output.slice(jsonStart);
}

module.exports = {
  runOpenClaw,
  runOpenClawAsync,
  extractJSON,
};
