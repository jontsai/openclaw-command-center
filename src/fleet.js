const { execFileSync } = require("child_process");

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_OUTPUT_CHARS = 500;

function truncate(value, max = MAX_OUTPUT_CHARS) {
  const text = String(value || "").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function runCommandCheck(check = {}) {
  if (!check.command) {
    return { ok: false, status: "unknown", error: "Missing command" };
  }

  try {
    const output = execFileSync(check.command, check.args || [], {
      encoding: "utf8",
      timeout: check.timeoutMs || DEFAULT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    return {
      ok: true,
      status: "ok",
      output: truncate(output),
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: truncate(error.stderr || error.stdout || error.message),
    };
  }
}

function runUrlCheck(check = {}) {
  if (!check.url) {
    return { ok: false, status: "unknown", error: "Missing URL" };
  }

  const timeoutSeconds = Math.max(1, Math.ceil((check.timeoutMs || DEFAULT_TIMEOUT_MS) / 1000));
  return runCommandCheck({
    command: "curl",
    args: ["-fsS", "--max-time", String(timeoutSeconds), check.url],
    timeoutMs: check.timeoutMs || DEFAULT_TIMEOUT_MS,
  });
}

function parseGatewayStatus(result) {
  if (!result.ok) {
    return { ...result, status: "offline" };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(result.output);
  } catch (e) {
    // Plain text health checks are allowed.
  }

  const healthy = parsed ? parsed.ok !== false : true;
  return {
    ...result,
    ok: healthy,
    status: healthy ? parsed?.status || "live" : "error",
    details: parsed || result.output,
  };
}

function checkGateway(gateway = {}) {
  if (gateway.type === "static") {
    return {
      ok: gateway.ok !== false,
      status: gateway.status || (gateway.ok === false ? "unknown" : "live"),
      details: gateway.details || null,
    };
  }

  const raw = gateway.type === "command" ? runCommandCheck(gateway) : runUrlCheck(gateway);
  return parseGatewayStatus(raw);
}

function checkCommandCenter(commandCenter = {}) {
  if (
    commandCenter.version ||
    commandCenter.installed === true ||
    commandCenter.type === "static"
  ) {
    return {
      installed: commandCenter.installed !== false,
      version: commandCenter.version || null,
      status: commandCenter.status || "installed",
    };
  }

  const result = runCommandCheck(commandCenter);
  if (!result.ok) {
    return {
      installed: false,
      version: null,
      status: "missing",
      error: result.error,
    };
  }

  return {
    installed: true,
    version: truncate(result.output, 80),
    status: "installed",
  };
}

function getFleetAgents(config) {
  const agents = config?.fleet?.agents || [];
  return agents.map((agent) => {
    const commandCenter = agent.commandCenter ? checkCommandCenter(agent.commandCenter) : null;
    const gateway = agent.gateway ? checkGateway(agent.gateway) : null;

    return {
      id: agent.id,
      name: agent.name,
      agentName: agent.agentName,
      project: agent.project,
      emoji: agent.emoji || "🦞",
      host: agent.host,
      profile: agent.profile,
      workspace: agent.workspace,
      dashboardUrl: agent.dashboardUrl || null,
      commandCenter,
      gateway,
    };
  });
}

module.exports = {
  getFleetAgents,
  runCommandCheck,
  runUrlCheck,
  checkGateway,
  checkCommandCenter,
};
