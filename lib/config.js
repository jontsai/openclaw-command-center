/**
 * Configuration loader with sensible defaults
 *
 * Priority order:
 * 1. Environment variables (highest)
 * 2. config/dashboard.json file
 * 3. Auto-detected paths
 * 4. Sensible defaults (lowest)
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const HOME = os.homedir();

/**
 * Get the OpenClaw profile directory (e.g., ~/.openclaw or ~/.openclaw-<profile>)
 * This is the canonical source for profile-aware paths.
 */
function getOpenClawDir(profile = null) {
  const effectiveProfile = profile || process.env.OPENCLAW_PROFILE || "";
  return effectiveProfile
    ? path.join(HOME, `.openclaw-${effectiveProfile}`)
    : path.join(HOME, ".openclaw");
}

/**
 * Auto-detect OpenClaw workspace by checking common locations
 * Profile-aware: checks profile-specific paths first when OPENCLAW_PROFILE is set
 */
function detectWorkspace() {
  const profile = process.env.OPENCLAW_PROFILE || "";
  const openclawDir = getOpenClawDir();
  const defaultWorkspace = path.join(openclawDir, "workspace");

  // Build candidates list - profile-specific paths come first
  const profileCandidates = profile
    ? [
        // Profile-specific workspace in home (e.g., ~/.openclaw-<profile>-workspace)
        path.join(HOME, `.openclaw-${profile}-workspace`),
        path.join(HOME, `.${profile}-workspace`),
      ]
    : [];

  const candidates = [
    // Environment variable (highest priority)
    process.env.OPENCLAW_WORKSPACE,
    // OpenClaw's default workspace location
    process.env.OPENCLAW_HOME,
    // Gateway config workspace (check early - this is where OpenClaw actually runs)
    getWorkspaceFromGatewayConfig(),
    // Profile-specific paths (if profile is set)
    ...profileCandidates,
    // Standard OpenClaw workspace location (profile-aware: ~/.openclaw/workspace or ~/.openclaw-<profile>/workspace)
    defaultWorkspace,
    // Common custom workspace names
    path.join(HOME, "openclaw-workspace"),
    path.join(HOME, ".openclaw-workspace"),
    // Legacy/custom names
    path.join(HOME, "molty"),
    path.join(HOME, "clawd"),
    path.join(HOME, "moltbot"),
  ].filter(Boolean);

  // Find first existing candidate that looks like a workspace
  const foundWorkspace = candidates.find((candidate) => {
    if (!candidate || !fs.existsSync(candidate)) {
      return false;
    }

    // Verify it looks like a workspace (has memory/ or state/ dir)
    const hasMemory = fs.existsSync(path.join(candidate, "memory"));
    const hasState = fs.existsSync(path.join(candidate, "state"));
    const hasConfig = fs.existsSync(path.join(candidate, ".openclaw"));

    return hasMemory || hasState || hasConfig;
  });

  // Return found workspace or default (will be created on first use)
  return foundWorkspace || defaultWorkspace;
}

/**
 * Try to get workspace from OpenClaw gateway config
 * Profile-aware: checks the profile directory first when OPENCLAW_PROFILE is set
 */
function getWorkspaceFromGatewayConfig() {
  const openclawDir = getOpenClawDir();
  const configPaths = [
    path.join(openclawDir, "config.yaml"),
    path.join(openclawDir, "config.json"),
    path.join(openclawDir, "openclaw.json"),
    path.join(openclawDir, "clawdbot.json"),
    // Fallback to standard XDG location
    path.join(HOME, ".config", "openclaw", "config.yaml"),
  ];

  for (const configPath of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, "utf8");
        // Simple extraction - look for workspace or workdir
        const match =
          content.match(/workspace[:\s]+["']?([^"'\n]+)/i) ||
          content.match(/workdir[:\s]+["']?([^"'\n]+)/i);
        if (match && match[1]) {
          const workspace = match[1].trim().replace(/^~/, HOME);
          if (fs.existsSync(workspace)) {
            return workspace;
          }
        }
      }
    } catch (e) {
      // Ignore errors, continue searching
    }
  }
  return null;
}

/**
 * Deep merge two objects (local overrides base)
 */
function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (
      override[key] &&
      typeof override[key] === "object" &&
      !Array.isArray(override[key]) &&
      base[key] &&
      typeof base[key] === "object"
    ) {
      result[key] = deepMerge(base[key], override[key]);
    } else if (override[key] !== null && override[key] !== undefined) {
      result[key] = override[key];
    }
  }
  return result;
}

/**
 * Load config files - base + local overrides
 */
function loadConfigFile() {
  const basePath = path.join(__dirname, "..", "config", "dashboard.json");
  const localPath = path.join(__dirname, "..", "config", "dashboard.local.json");

  let config = {};

  // Load base config
  try {
    if (fs.existsSync(basePath)) {
      const content = fs.readFileSync(basePath, "utf8");
      config = JSON.parse(content);
    }
  } catch (e) {
    console.warn(`[Config] Failed to load ${basePath}:`, e.message);
  }

  // Merge local overrides
  try {
    if (fs.existsSync(localPath)) {
      const content = fs.readFileSync(localPath, "utf8");
      const localConfig = JSON.parse(content);
      config = deepMerge(config, localConfig);
      console.log(`[Config] Loaded local overrides from ${localPath}`);
    }
  } catch (e) {
    console.warn(`[Config] Failed to load ${localPath}:`, e.message);
  }

  return config;
}

/**
 * Expand ~ and environment variables in paths
 */
function expandPath(p) {
  if (!p) return p;
  return p
    .replace(/^~/, HOME)
    .replace(/\$HOME/g, HOME)
    .replace(/\$\{HOME\}/g, HOME);
}

/**
 * Build final configuration
 */
function loadConfig() {
  const fileConfig = loadConfigFile();
  const workspace =
    process.env.OPENCLAW_WORKSPACE || expandPath(fileConfig.paths?.workspace) || detectWorkspace();

  const config = {
    // Server settings
    server: {
      port: parseInt(process.env.PORT || fileConfig.server?.port || "3333", 10),
      host: process.env.HOST || fileConfig.server?.host || "localhost",
    },

    // Paths - all relative to workspace unless absolute
    paths: {
      workspace: workspace,
      memory:
        expandPath(process.env.OPENCLAW_MEMORY_DIR || fileConfig.paths?.memory) ||
        path.join(workspace, "memory"),
      state:
        expandPath(process.env.OPENCLAW_STATE_DIR || fileConfig.paths?.state) ||
        path.join(workspace, "state"),
      cerebro:
        expandPath(process.env.OPENCLAW_CEREBRO_DIR || fileConfig.paths?.cerebro) ||
        path.join(workspace, "cerebro"),
      skills:
        expandPath(process.env.OPENCLAW_SKILLS_DIR || fileConfig.paths?.skills) ||
        path.join(workspace, "skills"),
      jobs:
        expandPath(process.env.OPENCLAW_JOBS_DIR || fileConfig.paths?.jobs) ||
        path.join(workspace, "jobs"),
      logs:
        expandPath(process.env.OPENCLAW_LOGS_DIR || fileConfig.paths?.logs) ||
        path.join(HOME, ".openclaw-command-center", "logs"),
    },

    // Auth settings
    auth: {
      mode: process.env.DASHBOARD_AUTH_MODE || fileConfig.auth?.mode || "none",
      token: process.env.DASHBOARD_TOKEN || fileConfig.auth?.token,
      allowedUsers: (
        process.env.DASHBOARD_ALLOWED_USERS ||
        fileConfig.auth?.allowedUsers?.join(",") ||
        ""
      )
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
      allowedIPs: (
        process.env.DASHBOARD_ALLOWED_IPS ||
        fileConfig.auth?.allowedIPs?.join(",") ||
        "127.0.0.1,::1"
      )
        .split(",")
        .map((s) => s.trim()),
      publicPaths: fileConfig.auth?.publicPaths || ["/api/health", "/api/whoami", "/favicon.ico"],
    },

    // Branding
    branding: {
      name: fileConfig.branding?.name || "OpenClaw Command Center",
      theme: fileConfig.branding?.theme || "default",
    },

    // Integrations
    integrations: {
      linear: {
        enabled: !!(process.env.LINEAR_API_KEY || fileConfig.integrations?.linear?.apiKey),
        apiKey: process.env.LINEAR_API_KEY || fileConfig.integrations?.linear?.apiKey,
        teamId: process.env.LINEAR_TEAM_ID || fileConfig.integrations?.linear?.teamId,
      },
    },

    // Billing - for cost savings calculation
    billing: {
      claudePlanCost: parseFloat(
        process.env.CLAUDE_PLAN_COST || fileConfig.billing?.claudePlanCost || "200",
      ),
      claudePlanName:
        process.env.CLAUDE_PLAN_NAME || fileConfig.billing?.claudePlanName || "Claude Code Max",
    },
  };

  return config;
}

// Export singleton config
const CONFIG = loadConfig();

// Log detected configuration on startup
console.log("[Config] Workspace:", CONFIG.paths.workspace);
console.log("[Config] Auth mode:", CONFIG.auth.mode);

module.exports = { CONFIG, loadConfig, detectWorkspace, expandPath, getOpenClawDir };
