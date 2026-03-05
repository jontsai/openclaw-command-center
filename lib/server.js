#!/usr/bin/env node
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) =>
  function __require() {
    return (
      mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod),
      mod.exports
    );
  };

// lib/src/utils.js
var require_utils = __commonJS({
  "lib/src/utils.js"(exports2, module2) {
    var { exec: exec2 } = require("child_process");
    var { promisify } = require("util");
    var execAsync = promisify(exec2);
    async function runCmd2(cmd, options = {}) {
      const systemPath = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
      const envPath = process.env.PATH || "";
      const opts = {
        encoding: "utf8",
        timeout: 1e4,
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
        if (options.fallback !== void 0) return options.fallback;
        throw e;
      }
    }
    function formatBytes2(bytes) {
      if (bytes >= 1099511627776) return (bytes / 1099511627776).toFixed(1) + " TB";
      if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + " GB";
      if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
      if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
      return bytes + " B";
    }
    function formatTimeAgo2(date) {
      const now = /* @__PURE__ */ new Date();
      const diffMs = now - date;
      const diffMins = Math.round(diffMs / 6e4);
      if (diffMins < 1) return "just now";
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffMins < 1440) return `${Math.round(diffMins / 60)}h ago`;
      return `${Math.round(diffMins / 1440)}d ago`;
    }
    function formatNumber2(n) {
      return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function formatTokens2(n) {
      if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
      if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
      return n.toString();
    }
    module2.exports = {
      runCmd: runCmd2,
      formatBytes: formatBytes2,
      formatTimeAgo: formatTimeAgo2,
      formatNumber: formatNumber2,
      formatTokens: formatTokens2,
    };
  },
});

// lib/src/vitals.js
var require_vitals = __commonJS({
  "lib/src/vitals.js"(exports2, module2) {
    var { runCmd: runCmd2, formatBytes: formatBytes2 } = require_utils();
    var cachedVitals = null;
    var lastVitalsUpdate = 0;
    var VITALS_CACHE_TTL = 3e4;
    var vitalsRefreshing = false;
    async function refreshVitalsAsync2() {
      if (vitalsRefreshing) return;
      vitalsRefreshing = true;
      const vitals = {
        hostname: "",
        uptime: "",
        disk: {
          used: 0,
          free: 0,
          total: 0,
          percent: 0,
          kbPerTransfer: 0,
          iops: 0,
          throughputMBps: 0,
        },
        cpu: { loadAvg: [0, 0, 0], cores: 0, usage: 0 },
        memory: { used: 0, free: 0, total: 0, percent: 0, pressure: "normal" },
        temperature: null,
      };
      const isLinux = process.platform === "linux";
      const isMacOS = process.platform === "darwin";
      try {
        const coresCmd = isLinux ? "nproc" : "sysctl -n hw.ncpu";
        const memCmd = isLinux
          ? "cat /proc/meminfo | grep MemTotal | awk '{print $2}'"
          : "sysctl -n hw.memsize";
        const topCmd = isLinux
          ? "top -bn1 | head -3 | grep -E '^%?Cpu|^  ?CPU' || echo ''"
          : 'top -l 1 -n 0 2>/dev/null | grep "CPU usage" || echo ""';
        const [hostname, uptimeRaw, coresRaw, memTotalRaw, memInfoRaw, dfRaw, topOutput] =
          await Promise.all([
            runCmd2("hostname", { fallback: "unknown" }),
            runCmd2("uptime", { fallback: "" }),
            runCmd2(coresCmd, { fallback: "1" }),
            runCmd2(memCmd, { fallback: "0" }),
            isLinux
              ? runCmd2("cat /proc/meminfo", { fallback: "" })
              : runCmd2("vm_stat", { fallback: "" }),
            runCmd2("df -k ~ | tail -1", { fallback: "" }),
            runCmd2(topCmd, { fallback: "" }),
          ]);
        vitals.hostname = hostname;
        const uptimeMatch = uptimeRaw.match(/up\s+([^,]+)/);
        if (uptimeMatch) vitals.uptime = uptimeMatch[1].trim();
        const loadMatch = uptimeRaw.match(/load averages?:\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
        if (loadMatch)
          vitals.cpu.loadAvg = [
            parseFloat(loadMatch[1]),
            parseFloat(loadMatch[2]),
            parseFloat(loadMatch[3]),
          ];
        vitals.cpu.cores = parseInt(coresRaw, 10) || 1;
        vitals.cpu.usage = Math.min(
          100,
          Math.round((vitals.cpu.loadAvg[0] / vitals.cpu.cores) * 100),
        );
        if (topOutput) {
          if (isLinux) {
            const userMatch = topOutput.match(/([\d.]+)\s*us/);
            const sysMatch = topOutput.match(/([\d.]+)\s*sy/);
            const idleMatch = topOutput.match(/([\d.]+)\s*id/);
            vitals.cpu.userPercent = userMatch ? parseFloat(userMatch[1]) : null;
            vitals.cpu.sysPercent = sysMatch ? parseFloat(sysMatch[1]) : null;
            vitals.cpu.idlePercent = idleMatch ? parseFloat(idleMatch[1]) : null;
            if (vitals.cpu.userPercent !== null && vitals.cpu.sysPercent !== null) {
              vitals.cpu.usage = Math.round(vitals.cpu.userPercent + vitals.cpu.sysPercent);
            }
          } else {
            const userMatch = topOutput.match(/([\d.]+)%\s*user/);
            const sysMatch = topOutput.match(/([\d.]+)%\s*sys/);
            const idleMatch = topOutput.match(/([\d.]+)%\s*idle/);
            vitals.cpu.userPercent = userMatch ? parseFloat(userMatch[1]) : null;
            vitals.cpu.sysPercent = sysMatch ? parseFloat(sysMatch[1]) : null;
            vitals.cpu.idlePercent = idleMatch ? parseFloat(idleMatch[1]) : null;
            if (vitals.cpu.userPercent !== null && vitals.cpu.sysPercent !== null) {
              vitals.cpu.usage = Math.round(vitals.cpu.userPercent + vitals.cpu.sysPercent);
            }
          }
        }
        const dfParts = dfRaw.split(/\s+/);
        if (dfParts.length >= 4) {
          vitals.disk.total = parseInt(dfParts[1], 10) * 1024;
          vitals.disk.used = parseInt(dfParts[2], 10) * 1024;
          vitals.disk.free = parseInt(dfParts[3], 10) * 1024;
          vitals.disk.percent = Math.round(
            (parseInt(dfParts[2], 10) / parseInt(dfParts[1], 10)) * 100,
          );
        }
        if (isLinux) {
          const memTotalKB = parseInt(memTotalRaw, 10) || 0;
          const memAvailableMatch = memInfoRaw.match(/MemAvailable:\s+(\d+)/);
          const memFreeMatch = memInfoRaw.match(/MemFree:\s+(\d+)/);
          vitals.memory.total = memTotalKB * 1024;
          const memAvailable =
            parseInt(memAvailableMatch?.[1] || memFreeMatch?.[1] || 0, 10) * 1024;
          vitals.memory.used = vitals.memory.total - memAvailable;
          vitals.memory.free = memAvailable;
          vitals.memory.percent =
            vitals.memory.total > 0
              ? Math.round((vitals.memory.used / vitals.memory.total) * 100)
              : 0;
        } else {
          const pageSizeMatch = memInfoRaw.match(/page size of (\d+) bytes/);
          const pageSize = pageSizeMatch ? parseInt(pageSizeMatch[1], 10) : 4096;
          const activePages = parseInt(
            (memInfoRaw.match(/Pages active:\s+(\d+)/) || [])[1] || 0,
            10,
          );
          const wiredPages = parseInt(
            (memInfoRaw.match(/Pages wired down:\s+(\d+)/) || [])[1] || 0,
            10,
          );
          const compressedPages = parseInt(
            (memInfoRaw.match(/Pages occupied by compressor:\s+(\d+)/) || [])[1] || 0,
            10,
          );
          vitals.memory.total = parseInt(memTotalRaw, 10) || 0;
          vitals.memory.used = (activePages + wiredPages + compressedPages) * pageSize;
          vitals.memory.free = vitals.memory.total - vitals.memory.used;
          vitals.memory.percent =
            vitals.memory.total > 0
              ? Math.round((vitals.memory.used / vitals.memory.total) * 100)
              : 0;
        }
        vitals.memory.pressure =
          vitals.memory.percent > 90
            ? "critical"
            : vitals.memory.percent > 75
              ? "warning"
              : "normal";
        const iostatCmd = isLinux
          ? "timeout 5 iostat -d -o JSON 1 2 2>/dev/null || echo ''"
          : "iostat -d -c 2 2>/dev/null | tail -1 || echo ''";
        const [perfCores, effCores, chip, iostatRaw] = await Promise.all([
          isMacOS
            ? runCmd2("sysctl -n hw.perflevel0.logicalcpu 2>/dev/null || echo 0", { fallback: "0" })
            : Promise.resolve("0"),
          isMacOS
            ? runCmd2("sysctl -n hw.perflevel1.logicalcpu 2>/dev/null || echo 0", { fallback: "0" })
            : Promise.resolve("0"),
          isMacOS
            ? runCmd2(
                'system_profiler SPHardwareDataType 2>/dev/null | grep "Chip:" | cut -d: -f2 || echo ""',
                { fallback: "" },
              )
            : Promise.resolve(""),
          runCmd2(iostatCmd, { fallback: "", timeout: 5e3 }),
        ]);
        if (isLinux) {
          const cpuBrand = await runCmd2(
            "cat /proc/cpuinfo | grep 'model name' | head -1 | cut -d: -f2",
            { fallback: "" },
          );
          if (cpuBrand) vitals.cpu.brand = cpuBrand.trim();
        }
        vitals.cpu.pCores = parseInt(perfCores, 10) || null;
        vitals.cpu.eCores = parseInt(effCores, 10) || null;
        if (chip) vitals.cpu.chip = chip;
        if (isLinux) {
          try {
            const iostatJson = JSON.parse(iostatRaw);
            const samples = iostatJson.sysstat.hosts[0].statistics;
            const disks = samples[samples.length - 1].disk;
            const disk = disks
              .filter((d) => !d.disk_device.startsWith("loop"))
              .sort((a, b) => b.tps - a.tps)[0];
            if (disk) {
              const kbReadPerSec = disk["kB_read/s"] || 0;
              const kbWrtnPerSec = disk["kB_wrtn/s"] || 0;
              vitals.disk.iops = disk.tps || 0;
              vitals.disk.throughputMBps = (kbReadPerSec + kbWrtnPerSec) / 1024;
              vitals.disk.kbPerTransfer =
                disk.tps > 0 ? (kbReadPerSec + kbWrtnPerSec) / disk.tps : 0;
            }
          } catch {}
        } else {
          const iostatParts = iostatRaw.split(/\s+/);
          if (iostatParts.length >= 3) {
            vitals.disk.kbPerTransfer = parseFloat(iostatParts[0]) || 0;
            vitals.disk.iops = parseFloat(iostatParts[1]) || 0;
            vitals.disk.throughputMBps = parseFloat(iostatParts[2]) || 0;
          }
        }
        vitals.temperature = null;
        vitals.temperatureNote = null;
        const isAppleSilicon = vitals.cpu.chip && /apple/i.test(vitals.cpu.chip);
        if (isAppleSilicon) {
          vitals.temperatureNote = "Apple Silicon (requires elevated access)";
          try {
            const pmOutput = await runCmd2(
              'sudo -n powermetrics --samplers smc -i 1 -n 1 2>/dev/null | grep -i "die temp" | head -1',
              { fallback: "", timeout: 5e3 },
            );
            const tempMatch = pmOutput.match(/([\d.]+)/);
            if (tempMatch) {
              vitals.temperature = parseFloat(tempMatch[1]);
              vitals.temperatureNote = null;
            }
          } catch (e) {}
        } else if (isMacOS) {
          const home = require("os").homedir();
          try {
            const temp = await runCmd2(
              `osx-cpu-temp 2>/dev/null || ${home}/bin/osx-cpu-temp 2>/dev/null`,
              { fallback: "" },
            );
            if (temp && temp.includes("\xB0")) {
              const tempMatch = temp.match(/([\d.]+)/);
              if (tempMatch && parseFloat(tempMatch[1]) > 0) {
                vitals.temperature = parseFloat(tempMatch[1]);
              }
            }
          } catch (e) {}
          if (!vitals.temperature) {
            try {
              const ioregRaw = await runCmd2(
                "ioreg -r -n AppleSmartBattery 2>/dev/null | grep Temperature",
                { fallback: "" },
              );
              const tempMatch = ioregRaw.match(/"Temperature"\s*=\s*(\d+)/);
              if (tempMatch) {
                vitals.temperature = Math.round(parseInt(tempMatch[1], 10) / 100);
              }
            } catch (e) {}
          }
        } else if (isLinux) {
          try {
            const temp = await runCmd2("cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null", {
              fallback: "",
            });
            if (temp) {
              vitals.temperature = Math.round(parseInt(temp, 10) / 1e3);
            }
          } catch (e) {}
        }
      } catch (e) {
        console.error("[Vitals] Async refresh failed:", e.message);
      }
      vitals.memory.usedFormatted = formatBytes2(vitals.memory.used);
      vitals.memory.totalFormatted = formatBytes2(vitals.memory.total);
      vitals.memory.freeFormatted = formatBytes2(vitals.memory.free);
      vitals.disk.usedFormatted = formatBytes2(vitals.disk.used);
      vitals.disk.totalFormatted = formatBytes2(vitals.disk.total);
      vitals.disk.freeFormatted = formatBytes2(vitals.disk.free);
      cachedVitals = vitals;
      lastVitalsUpdate = Date.now();
      vitalsRefreshing = false;
      console.log("[Vitals] Cache refreshed async");
    }
    setTimeout(() => refreshVitalsAsync2(), 500);
    setInterval(() => refreshVitalsAsync2(), VITALS_CACHE_TTL);
    function getSystemVitals2() {
      const now = Date.now();
      if (!cachedVitals || now - lastVitalsUpdate > VITALS_CACHE_TTL) {
        refreshVitalsAsync2();
      }
      if (cachedVitals) return cachedVitals;
      return {
        hostname: "loading...",
        uptime: "",
        disk: {
          used: 0,
          free: 0,
          total: 0,
          percent: 0,
          usedFormatted: "-",
          totalFormatted: "-",
          freeFormatted: "-",
        },
        cpu: { loadAvg: [0, 0, 0], cores: 0, usage: 0 },
        memory: {
          used: 0,
          free: 0,
          total: 0,
          percent: 0,
          pressure: "normal",
          usedFormatted: "-",
          totalFormatted: "-",
          freeFormatted: "-",
        },
        temperature: null,
      };
    }
    module2.exports = {
      refreshVitalsAsync: refreshVitalsAsync2,
      getSystemVitals: getSystemVitals2,
      VITALS_CACHE_TTL,
    };
  },
});

// lib/src/openclaw.js
var require_openclaw = __commonJS({
  "lib/src/openclaw.js"(exports2, module2) {
    var { execSync: execSync2, exec: exec2 } = require("child_process");
    var { promisify } = require("util");
    var execAsync = promisify(exec2);
    function runOpenClaw2(args2) {
      const profile = process.env.OPENCLAW_PROFILE || "";
      const profileFlag = profile ? ` --profile ${profile}` : "";
      try {
        const result = execSync2(`openclaw${profileFlag} ${args2}`, {
          encoding: "utf8",
          timeout: 3e3,
          // 3 second timeout - don't block server
          env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
          stdio: ["pipe", "pipe", "pipe"],
          // Capture all output
        });
        return result;
      } catch (e) {
        return null;
      }
    }
    async function runOpenClawAsync2(args2) {
      const profile = process.env.OPENCLAW_PROFILE || "";
      const profileFlag = profile ? ` --profile ${profile}` : "";
      try {
        const { stdout } = await execAsync(`openclaw${profileFlag} ${args2}`, {
          encoding: "utf8",
          timeout: 1e4,
          // 10 second timeout for async
          env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
        });
        return stdout;
      } catch (e) {
        console.error("[OpenClaw Async] Error:", e.message);
        return null;
      }
    }
    function extractJSON2(output) {
      if (!output) return null;
      const jsonStart = output.search(/[[{]/);
      if (jsonStart === -1) return null;
      return output.slice(jsonStart);
    }
    module2.exports = {
      runOpenClaw: runOpenClaw2,
      runOpenClawAsync: runOpenClawAsync2,
      extractJSON: extractJSON2,
    };
  },
});

// lib/config.js
var require_config = __commonJS({
  "lib/config.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var os = require("os");
    var HOME = os.homedir();
    function getOpenClawDir2(profile = null) {
      const effectiveProfile = profile || process.env.OPENCLAW_PROFILE || "";
      return effectiveProfile
        ? path2.join(HOME, `.openclaw-${effectiveProfile}`)
        : path2.join(HOME, ".openclaw");
    }
    function detectWorkspace() {
      const profile = process.env.OPENCLAW_PROFILE || "";
      const openclawDir = getOpenClawDir2();
      const defaultWorkspace = path2.join(openclawDir, "workspace");
      const profileCandidates = profile
        ? [
            // Profile-specific workspace in home (e.g., ~/.openclaw-<profile>-workspace)
            path2.join(HOME, `.openclaw-${profile}-workspace`),
            path2.join(HOME, `.${profile}-workspace`),
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
        path2.join(HOME, "openclaw-workspace"),
        path2.join(HOME, ".openclaw-workspace"),
        // Legacy/custom names
        path2.join(HOME, "molty"),
        path2.join(HOME, "clawd"),
        path2.join(HOME, "moltbot"),
      ].filter(Boolean);
      const foundWorkspace = candidates.find((candidate) => {
        if (!candidate || !fs2.existsSync(candidate)) {
          return false;
        }
        const hasMemory = fs2.existsSync(path2.join(candidate, "memory"));
        const hasState = fs2.existsSync(path2.join(candidate, "state"));
        const hasConfig = fs2.existsSync(path2.join(candidate, ".openclaw"));
        return hasMemory || hasState || hasConfig;
      });
      return foundWorkspace || defaultWorkspace;
    }
    function getWorkspaceFromGatewayConfig() {
      const openclawDir = getOpenClawDir2();
      const configPaths = [
        path2.join(openclawDir, "config.yaml"),
        path2.join(openclawDir, "config.json"),
        path2.join(openclawDir, "openclaw.json"),
        path2.join(openclawDir, "clawdbot.json"),
        // Fallback to standard XDG location
        path2.join(HOME, ".config", "openclaw", "config.yaml"),
      ];
      for (const configPath of configPaths) {
        try {
          if (fs2.existsSync(configPath)) {
            const content = fs2.readFileSync(configPath, "utf8");
            const match =
              content.match(/workspace[:\s]+["']?([^"'\n]+)/i) ||
              content.match(/workdir[:\s]+["']?([^"'\n]+)/i);
            if (match && match[1]) {
              const workspace = match[1].trim().replace(/^~/, HOME);
              if (fs2.existsSync(workspace)) {
                return workspace;
              }
            }
          }
        } catch (e) {}
      }
      return null;
    }
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
        } else if (override[key] !== null && override[key] !== void 0) {
          result[key] = override[key];
        }
      }
      return result;
    }
    function loadConfigFile() {
      const basePath = path2.join(__dirname, "..", "config", "dashboard.json");
      const localPath = path2.join(__dirname, "..", "config", "dashboard.local.json");
      let config = {};
      try {
        if (fs2.existsSync(basePath)) {
          const content = fs2.readFileSync(basePath, "utf8");
          config = JSON.parse(content);
        }
      } catch (e) {
        console.warn(`[Config] Failed to load ${basePath}:`, e.message);
      }
      try {
        if (fs2.existsSync(localPath)) {
          const content = fs2.readFileSync(localPath, "utf8");
          const localConfig = JSON.parse(content);
          config = deepMerge(config, localConfig);
          console.log(`[Config] Loaded local overrides from ${localPath}`);
        }
      } catch (e) {
        console.warn(`[Config] Failed to load ${localPath}:`, e.message);
      }
      return config;
    }
    function expandPath(p) {
      if (!p) return p;
      return p
        .replace(/^~/, HOME)
        .replace(/\$HOME/g, HOME)
        .replace(/\$\{HOME\}/g, HOME);
    }
    function loadConfig() {
      const fileConfig = loadConfigFile();
      const workspace =
        process.env.OPENCLAW_WORKSPACE ||
        expandPath(fileConfig.paths?.workspace) ||
        detectWorkspace();
      const config = {
        // Server settings
        server: {
          port: parseInt(process.env.PORT || fileConfig.server?.port || "3333", 10),
          host: process.env.HOST || fileConfig.server?.host || "localhost",
        },
        // Paths - all relative to workspace unless absolute
        paths: {
          workspace,
          memory:
            expandPath(process.env.OPENCLAW_MEMORY_DIR || fileConfig.paths?.memory) ||
            path2.join(workspace, "memory"),
          state:
            expandPath(process.env.OPENCLAW_STATE_DIR || fileConfig.paths?.state) ||
            path2.join(workspace, "state"),
          cerebro:
            expandPath(process.env.OPENCLAW_CEREBRO_DIR || fileConfig.paths?.cerebro) ||
            path2.join(workspace, "cerebro"),
          skills:
            expandPath(process.env.OPENCLAW_SKILLS_DIR || fileConfig.paths?.skills) ||
            path2.join(workspace, "skills"),
          jobs:
            expandPath(process.env.OPENCLAW_JOBS_DIR || fileConfig.paths?.jobs) ||
            path2.join(workspace, "jobs"),
          logs:
            expandPath(process.env.OPENCLAW_LOGS_DIR || fileConfig.paths?.logs) ||
            path2.join(HOME, ".openclaw-command-center", "logs"),
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
          publicPaths: fileConfig.auth?.publicPaths || [
            "/api/health",
            "/api/whoami",
            "/favicon.ico",
          ],
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
    var CONFIG2 = loadConfig();
    console.log("[Config] Workspace:", CONFIG2.paths.workspace);
    console.log("[Config] Auth mode:", CONFIG2.auth.mode);
    module2.exports = {
      CONFIG: CONFIG2,
      loadConfig,
      detectWorkspace,
      expandPath,
      getOpenClawDir: getOpenClawDir2,
    };
  },
});

// lib/jobs.js
var require_jobs = __commonJS({
  "lib/jobs.js"(exports2, module2) {
    var path2 = require("path");
    var { CONFIG: CONFIG2 } = require_config();
    var JOBS_DIR = CONFIG2.paths.jobs;
    var JOBS_STATE_DIR = path2.join(CONFIG2.paths.state, "jobs");
    var apiInstance = null;
    var forceApiUnavailable = false;
    async function getAPI() {
      if (forceApiUnavailable) return null;
      if (apiInstance) return apiInstance;
      try {
        const { createJobsAPI } = await import(path2.join(JOBS_DIR, "lib/api.js"));
        apiInstance = createJobsAPI({
          definitionsDir: path2.join(JOBS_DIR, "definitions"),
          stateDir: JOBS_STATE_DIR,
        });
        return apiInstance;
      } catch (e) {
        console.error("Failed to load jobs API:", e.message);
        return null;
      }
    }
    function _resetForTesting(options = {}) {
      apiInstance = null;
      forceApiUnavailable = options.forceUnavailable || false;
    }
    function formatRelativeTime(isoString) {
      if (!isoString) return null;
      const date = new Date(isoString);
      const now = /* @__PURE__ */ new Date();
      const diffMs = now - date;
      const diffMins = Math.round(diffMs / 6e4);
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
    async function handleJobsRequest2(req, res, pathname, query, method) {
      const api = await getAPI();
      if (!api) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Jobs API not available" }));
        return;
      }
      try {
        if (pathname === "/api/jobs/scheduler/status" && method === "GET") {
          const status = await api.getSchedulerStatus();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(status, null, 2));
          return;
        }
        if (pathname === "/api/jobs/stats" && method === "GET") {
          const stats = await api.getAggregateStats();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(stats, null, 2));
          return;
        }
        if (pathname === "/api/jobs/cache/clear" && method === "POST") {
          api.clearCache();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, message: "Cache cleared" }));
          return;
        }
        if (pathname === "/api/jobs" && method === "GET") {
          const jobs = await api.listJobs();
          const enhanced = jobs.map((job) => ({
            ...job,
            lastRunRelative: formatRelativeTime(job.lastRun),
            nextRunRelative: formatRelativeTime(job.nextRun),
          }));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jobs: enhanced, timestamp: Date.now() }, null, 2));
          return;
        }
        const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
        if (jobMatch && method === "GET") {
          const jobId = decodeURIComponent(jobMatch[1]);
          const job = await api.getJob(jobId);
          if (!job) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Job not found" }));
            return;
          }
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
        const runMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/run$/);
        if (runMatch && method === "POST") {
          const jobId = decodeURIComponent(runMatch[1]);
          const result = await api.runJob(jobId);
          res.writeHead(result.success ? 200 : 400, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result, null, 2));
          return;
        }
        const pauseMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/pause$/);
        if (pauseMatch && method === "POST") {
          const jobId = decodeURIComponent(pauseMatch[1]);
          let body = "";
          await new Promise((resolve) => {
            req.on("data", (chunk) => (body += chunk));
            req.on("end", resolve);
          });
          let reason = null;
          try {
            const parsed = JSON.parse(body || "{}");
            reason = parsed.reason;
          } catch (_e) {}
          const result = await api.pauseJob(jobId, {
            by: req.authUser?.login || "dashboard",
            reason,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result, null, 2));
          return;
        }
        const resumeMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/resume$/);
        if (resumeMatch && method === "POST") {
          const jobId = decodeURIComponent(resumeMatch[1]);
          const result = await api.resumeJob(jobId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result, null, 2));
          return;
        }
        const skipMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/skip$/);
        if (skipMatch && method === "POST") {
          const jobId = decodeURIComponent(skipMatch[1]);
          const result = await api.skipJob(jobId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result, null, 2));
          return;
        }
        const killMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/kill$/);
        if (killMatch && method === "POST") {
          const jobId = decodeURIComponent(killMatch[1]);
          const result = await api.killJob(jobId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result, null, 2));
          return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      } catch (e) {
        console.error("Jobs API error:", e);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    }
    function isJobsRoute2(pathname) {
      return pathname.startsWith("/api/jobs");
    }
    module2.exports = {
      handleJobsRequest: handleJobsRequest2,
      isJobsRoute: isJobsRoute2,
      _resetForTesting,
    };
  },
});

// lib/src/index.js
var http = require("http");
var fs = require("fs");
var path = require("path");
var { execSync, exec } = require("child_process");
var { runCmd, formatBytes, formatTimeAgo, formatNumber, formatTokens } = require_utils();
var { getSystemVitals, refreshVitalsAsync } = require_vitals();
var { runOpenClaw, runOpenClawAsync, extractJSON } = require_openclaw();
var args = process.argv.slice(2);
var cliProfile = null;
var cliPort = null;
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--profile":
    case "-p":
      cliProfile = args[++i];
      break;
    case "--port":
      cliPort = parseInt(args[++i], 10);
      break;
    case "--help":
    case "-h":
      console.log(`
OpenClaw Command Center

Usage: node lib/server.js [options]

Options:
  --profile, -p <name>  OpenClaw profile (uses ~/.openclaw-<name>)
  --port <port>         Server port (default: 3333)
  --help, -h            Show this help

Environment:
  OPENCLAW_PROFILE      Same as --profile
  PORT                  Same as --port

Examples:
  node lib/server.js --profile production
  node lib/server.js -p dev --port 3334
`);
      process.exit(0);
  }
}
if (cliProfile) {
  process.env.OPENCLAW_PROFILE = cliProfile;
}
if (cliPort) {
  process.env.PORT = cliPort.toString();
}
var { CONFIG, getOpenClawDir } = require_config();
var { handleJobsRequest, isJobsRoute } = require_jobs();
var PORT = CONFIG.server.port;
var DASHBOARD_DIR = path.join(__dirname, "../public");
var AUTH_CONFIG = {
  mode: CONFIG.auth.mode,
  token: CONFIG.auth.token,
  allowedUsers: CONFIG.auth.allowedUsers,
  allowedIPs: CONFIG.auth.allowedIPs,
  publicPaths: CONFIG.auth.publicPaths,
};
var AUTH_HEADERS = {
  tailscale: {
    login: "tailscale-user-login",
    name: "tailscale-user-name",
    pic: "tailscale-user-profile-pic",
  },
  cloudflare: {
    email: "cf-access-authenticated-user-email",
  },
};
var PATHS = CONFIG.paths;
var sseClients = /* @__PURE__ */ new Set();
function sendSSE(res, event, data) {
  try {
    res.write(`event: ${event}
data: ${JSON.stringify(data)}

`);
  } catch (e) {}
}
function broadcastSSE(event, data) {
  for (const client of sseClients) {
    sendSSE(client, event, data);
  }
}
var DATA_DIR = path.join(getOpenClawDir(), "command-center", "data");
var LEGACY_DATA_DIR = path.join(DASHBOARD_DIR, "data");
function migrateDataDir() {
  try {
    if (!fs.existsSync(LEGACY_DATA_DIR)) return;
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const legacyFiles = fs.readdirSync(LEGACY_DATA_DIR);
    if (legacyFiles.length === 0) return;
    let migrated = 0;
    for (const file of legacyFiles) {
      const srcPath = path.join(LEGACY_DATA_DIR, file);
      const destPath = path.join(DATA_DIR, file);
      if (fs.existsSync(destPath)) continue;
      const stat = fs.statSync(srcPath);
      if (stat.isFile()) {
        fs.copyFileSync(srcPath, destPath);
        migrated++;
        console.log(`[Migration] Copied ${file} to profile-aware data dir`);
      }
    }
    if (migrated > 0) {
      console.log(`[Migration] Migrated ${migrated} file(s) to ${DATA_DIR}`);
      console.log(`[Migration] Legacy data preserved at ${LEGACY_DATA_DIR}`);
    }
  } catch (e) {
    console.error("[Migration] Failed to migrate data:", e.message);
  }
}
process.nextTick(migrateDataDir);
var PRIVACY_FILE = path.join(DATA_DIR, "privacy-settings.json");
function loadPrivacySettings() {
  try {
    if (fs.existsSync(PRIVACY_FILE)) {
      return JSON.parse(fs.readFileSync(PRIVACY_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Failed to load privacy settings:", e.message);
  }
  return {
    version: 1,
    hiddenTopics: [],
    hiddenSessions: [],
    hiddenCrons: [],
    hideHostname: false,
    updatedAt: null,
  };
}
function savePrivacySettings(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    data.updatedAt = /* @__PURE__ */ new Date().toISOString();
    fs.writeFileSync(PRIVACY_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error("Failed to save privacy settings:", e.message);
    return false;
  }
}
var OPERATORS_FILE = path.join(DATA_DIR, "operators.json");
function loadOperators() {
  try {
    if (fs.existsSync(OPERATORS_FILE)) {
      return JSON.parse(fs.readFileSync(OPERATORS_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Failed to load operators:", e.message);
  }
  return { version: 1, operators: [], roles: {} };
}
function saveOperators(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(OPERATORS_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error("Failed to save operators:", e.message);
    return false;
  }
}
function getOperatorBySlackId(slackId) {
  const data = loadOperators();
  return data.operators.find((op) => op.id === slackId || op.metadata?.slackId === slackId);
}
var operatorsRefreshing = false;
async function refreshOperatorsAsync() {
  if (operatorsRefreshing) return;
  operatorsRefreshing = true;
  try {
    const openclawDir = getOpenClawDir();
    const sessionsDir = path.join(openclawDir, "agents", "main", "sessions");
    if (!fs.existsSync(sessionsDir)) {
      operatorsRefreshing = false;
      return;
    }
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    const operatorsMap = /* @__PURE__ */ new Map();
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1e3;
    for (const file of files) {
      const filePath = path.join(sessionsDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < sevenDaysAgo) continue;
        const fd = fs.openSync(filePath, "r");
        const buffer = Buffer.alloc(10240);
        const bytesRead = fs.readSync(fd, buffer, 0, 10240, 0);
        fs.closeSync(fd);
        const content = buffer.toString("utf8", 0, bytesRead);
        const lines = content.split("\n").slice(0, 20);
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.type !== "message" || !entry.message) continue;
            const msg = entry.message;
            if (msg.role !== "user") continue;
            let text = "";
            if (typeof msg.content === "string") {
              text = msg.content;
            } else if (Array.isArray(msg.content)) {
              const textPart = msg.content.find((c) => c.type === "text");
              if (textPart) text = textPart.text || "";
            }
            if (!text) continue;
            const slackMatch = text.match(/\[Slack[^\]]*\]\s*([\w.-]+)\s*\(([A-Z0-9]+)\):/);
            if (slackMatch) {
              const username = slackMatch[1];
              const userId = slackMatch[2];
              if (!operatorsMap.has(userId)) {
                operatorsMap.set(userId, {
                  id: userId,
                  name: username,
                  username,
                  source: "slack",
                  firstSeen: entry.timestamp || stat.mtimeMs,
                  lastSeen: entry.timestamp || stat.mtimeMs,
                  sessionCount: 1,
                });
              } else {
                const op = operatorsMap.get(userId);
                op.lastSeen = Math.max(op.lastSeen, entry.timestamp || stat.mtimeMs);
                op.sessionCount++;
              }
              break;
            }
            const telegramMatch = text.match(/\[Telegram[^\]]*\]\s*([\w.-]+):/);
            if (telegramMatch) {
              const username = telegramMatch[1];
              const oderId = `telegram:${username}`;
              if (!operatorsMap.has(oderId)) {
                operatorsMap.set(oderId, {
                  id: oderId,
                  name: username,
                  username,
                  source: "telegram",
                  firstSeen: entry.timestamp || stat.mtimeMs,
                  lastSeen: entry.timestamp || stat.mtimeMs,
                  sessionCount: 1,
                });
              } else {
                const op = operatorsMap.get(oderId);
                op.lastSeen = Math.max(op.lastSeen, entry.timestamp || stat.mtimeMs);
                op.sessionCount++;
              }
              break;
            }
            const discordSenderMatch = text.match(/"sender":\s*"(\d+)"/);
            const discordLabelMatch = text.match(/"label":\s*"([^"]+)"/);
            const discordUsernameMatch = text.match(/"username":\s*"([^"]+)"/);
            if (discordSenderMatch) {
              const userId = discordSenderMatch[1];
              const label = discordLabelMatch ? discordLabelMatch[1] : userId;
              const username = discordUsernameMatch ? discordUsernameMatch[1] : label;
              const opId = `discord:${userId}`;
              if (!operatorsMap.has(opId)) {
                operatorsMap.set(opId, {
                  id: opId,
                  discordId: userId,
                  name: label,
                  username,
                  source: "discord",
                  firstSeen: entry.timestamp || stat.mtimeMs,
                  lastSeen: entry.timestamp || stat.mtimeMs,
                  sessionCount: 1,
                });
              } else {
                const op = operatorsMap.get(opId);
                op.lastSeen = Math.max(op.lastSeen, entry.timestamp || stat.mtimeMs);
                op.sessionCount++;
              }
              break;
            }
          } catch (e) {}
        }
      } catch (e) {}
    }
    const existing = loadOperators();
    const existingMap = new Map(existing.operators.map((op) => [op.id, op]));
    for (const [id, autoOp] of operatorsMap) {
      if (existingMap.has(id)) {
        const manual = existingMap.get(id);
        manual.lastSeen = Math.max(manual.lastSeen || 0, autoOp.lastSeen);
        manual.sessionCount = (manual.sessionCount || 0) + autoOp.sessionCount;
      } else {
        existingMap.set(id, autoOp);
      }
    }
    const merged = {
      version: 1,
      operators: Array.from(existingMap.values()).sort(
        (a, b) => (b.lastSeen || 0) - (a.lastSeen || 0),
      ),
      roles: existing.roles || {},
      lastRefreshed: Date.now(),
    };
    saveOperators(merged);
    console.log(`[Operators] Refreshed: ${merged.operators.length} operators detected`);
  } catch (e) {
    console.error("[Operators] Refresh failed:", e.message);
  }
  operatorsRefreshing = false;
}
setTimeout(() => refreshOperatorsAsync(), 2e3);
setInterval(() => refreshOperatorsAsync(), 5 * 60 * 1e3);
function getSessionOriginator(sessionId) {
  try {
    if (!sessionId) return null;
    const openclawDir = getOpenClawDir();
    const transcriptPath = path.join(
      openclawDir,
      "agents",
      "main",
      "sessions",
      `${sessionId}.jsonl`,
    );
    if (!fs.existsSync(transcriptPath)) return null;
    const content = fs.readFileSync(transcriptPath, "utf8");
    const lines = content.trim().split("\n");
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.type !== "message" || !entry.message) continue;
        const msg = entry.message;
        if (msg.role !== "user") continue;
        let text = "";
        if (typeof msg.content === "string") {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          const textPart = msg.content.find((c) => c.type === "text");
          if (textPart) text = textPart.text || "";
        }
        if (!text) continue;
        const slackUserMatch = text.match(/\]\s*([\w.-]+)\s*\(([A-Z0-9]+)\):/);
        if (slackUserMatch) {
          const username = slackUserMatch[1];
          const userId = slackUserMatch[2];
          const operator = getOperatorBySlackId(userId);
          return {
            userId,
            username,
            displayName: operator?.name || username,
            role: operator?.role || "user",
            avatar: operator?.avatar || null,
          };
        }
      } catch (e) {}
    }
    return null;
  } catch (e) {
    return null;
  }
}
function checkAuth(req) {
  const mode = AUTH_CONFIG.mode;
  const remoteAddr = req.socket?.remoteAddress || "";
  const isLocalhost =
    remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1";
  if (isLocalhost) {
    return { authorized: true, user: { type: "localhost", login: "localhost" } };
  }
  if (mode === "none") {
    return { authorized: true, user: null };
  }
  if (mode === "token") {
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (token && token === AUTH_CONFIG.token) {
      return { authorized: true, user: { type: "token" } };
    }
    return { authorized: false, reason: "Invalid or missing token" };
  }
  if (mode === "tailscale") {
    const login = (req.headers[AUTH_HEADERS.tailscale.login] || "").toLowerCase();
    const name = req.headers[AUTH_HEADERS.tailscale.name] || "";
    const pic = req.headers[AUTH_HEADERS.tailscale.pic] || "";
    if (!login) {
      return { authorized: false, reason: "Not accessed via Tailscale Serve" };
    }
    const isAllowed = AUTH_CONFIG.allowedUsers.some((allowed) => {
      if (allowed === "*") return true;
      if (allowed === login) return true;
      if (allowed.startsWith("*@")) {
        const domain = allowed.slice(2);
        return login.endsWith("@" + domain);
      }
      return false;
    });
    if (isAllowed) {
      return { authorized: true, user: { type: "tailscale", login, name, pic } };
    }
    return { authorized: false, reason: `User ${login} not in allowlist`, user: { login } };
  }
  if (mode === "cloudflare") {
    const email = (req.headers[AUTH_HEADERS.cloudflare.email] || "").toLowerCase();
    if (!email) {
      return { authorized: false, reason: "Not accessed via Cloudflare Access" };
    }
    const isAllowed = AUTH_CONFIG.allowedUsers.some((allowed) => {
      if (allowed === "*") return true;
      if (allowed === email) return true;
      if (allowed.startsWith("*@")) {
        const domain = allowed.slice(2);
        return email.endsWith("@" + domain);
      }
      return false;
    });
    if (isAllowed) {
      return { authorized: true, user: { type: "cloudflare", email } };
    }
    return { authorized: false, reason: `User ${email} not in allowlist`, user: { email } };
  }
  if (mode === "allowlist") {
    const clientIP =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "";
    const isAllowed = AUTH_CONFIG.allowedIPs.some((allowed) => {
      if (allowed === clientIP) return true;
      if (allowed.endsWith("/24")) {
        const prefix = allowed.slice(0, -3).split(".").slice(0, 3).join(".");
        return clientIP.startsWith(prefix + ".");
      }
      return false;
    });
    if (isAllowed) {
      return { authorized: true, user: { type: "ip", ip: clientIP } };
    }
    return { authorized: false, reason: `IP ${clientIP} not in allowlist` };
  }
  return { authorized: false, reason: "Unknown auth mode" };
}
function getUnauthorizedPage(reason, user) {
  const userInfo = user
    ? `<p class="user-info">Detected: ${user.login || user.email || user.ip || "unknown"}</p>`
    : "";
  return `<!DOCTYPE html>
<html>
<head>
    <title>Access Denied - Command Center</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #e8e8e8;
        }
        .container {
            text-align: center;
            padding: 3rem;
            background: rgba(255,255,255,0.05);
            border-radius: 16px;
            border: 1px solid rgba(255,255,255,0.1);
            max-width: 500px;
        }
        .icon { font-size: 4rem; margin-bottom: 1rem; }
        h1 { font-size: 1.8rem; margin-bottom: 1rem; color: #ff6b6b; }
        .reason { color: #aaa; margin-bottom: 1.5rem; font-size: 0.95rem; }
        .user-info { color: #ffeb3b; margin: 1rem 0; font-size: 0.9rem; }
        .instructions { color: #ccc; font-size: 0.85rem; line-height: 1.5; }
        .auth-mode { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1); color: #888; font-size: 0.75rem; }
        code { background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">\u{1F510}</div>
        <h1>Access Denied</h1>
        <div class="reason">${reason}</div>
        ${userInfo}
        <div class="instructions">
            <p>This dashboard requires authentication via <strong>${AUTH_CONFIG.mode}</strong>.</p>
            ${AUTH_CONFIG.mode === "tailscale" ? `<p style="margin-top:1rem">Make sure you're accessing via your Tailscale URL and your account is in the allowlist.</p>` : ""}
            ${AUTH_CONFIG.mode === "cloudflare" ? `<p style="margin-top:1rem">Make sure you're accessing via Cloudflare Access and your email is in the allowlist.</p>` : ""}
        </div>
        <div class="auth-mode">Auth mode: <code>${AUTH_CONFIG.mode}</code></div>
    </div>
</body>
</html>`;
}
var sessionsCache = { sessions: [], timestamp: 0, refreshing: false };
var SESSIONS_CACHE_TTL = 1e4;
async function refreshSessionsCache() {
  if (sessionsCache.refreshing) return;
  sessionsCache.refreshing = true;
  try {
    const output = await runOpenClawAsync("sessions list --json 2>/dev/null");
    const jsonStr = extractJSON(output);
    if (jsonStr) {
      const data = JSON.parse(jsonStr);
      const sessions = data.sessions || [];
      const mapped = sessions.map((s) => mapSession(s));
      sessionsCache = {
        sessions: mapped,
        timestamp: Date.now(),
        refreshing: false,
      };
      console.log(`[Sessions Cache] Refreshed: ${mapped.length} sessions`);
    }
  } catch (e) {
    console.error("[Sessions Cache] Refresh error:", e.message);
  }
  sessionsCache.refreshing = false;
}
function getSessionsCached() {
  const now = Date.now();
  const isStale = now - sessionsCache.timestamp > SESSIONS_CACHE_TTL;
  if (isStale && !sessionsCache.refreshing) {
    refreshSessionsCache();
  }
  return sessionsCache.sessions;
}
function mapSession(s) {
  const minutesAgo = s.ageMs ? s.ageMs / 6e4 : Infinity;
  let channel = "other";
  if (s.key.includes("slack")) channel = "slack";
  else if (s.key.includes("telegram")) channel = "telegram";
  else if (s.key.includes("discord")) channel = "discord";
  else if (s.key.includes("signal")) channel = "signal";
  else if (s.key.includes("whatsapp")) channel = "whatsapp";
  let sessionType = "channel";
  if (s.key.includes(":subagent:")) sessionType = "subagent";
  else if (s.key.includes(":cron:")) sessionType = "cron";
  else if (s.key === "agent:main:main") sessionType = "main";
  const originator = getSessionOriginator(s.sessionId);
  const label = s.groupChannel || s.displayName || parseSessionLabel(s.key);
  const topic = getSessionTopic(s.sessionId);
  const totalTokens = s.totalTokens || 0;
  const sessionAgeMinutes = Math.max(1, Math.min(minutesAgo, 24 * 60));
  const burnRate = Math.round(totalTokens / sessionAgeMinutes);
  return {
    sessionKey: s.key,
    sessionId: s.sessionId,
    label,
    groupChannel: s.groupChannel || null,
    displayName: s.displayName || null,
    kind: s.kind,
    channel,
    sessionType,
    active: minutesAgo < 15,
    recentlyActive: minutesAgo < 60,
    minutesAgo: Math.round(minutesAgo),
    tokens: s.totalTokens || 0,
    model: s.model,
    originator,
    topic,
    metrics: {
      burnRate,
      toolCalls: 0,
      minutesActive: Math.max(1, Math.min(Math.round(minutesAgo), 24 * 60)),
    },
  };
}
var TOPIC_PATTERNS = {
  // Core system topics
  dashboard: ["dashboard", "command center", "ui", "interface", "status page"],
  scheduling: ["cron", "schedule", "timer", "reminder", "alarm", "periodic", "interval"],
  heartbeat: [
    "heartbeat",
    "heartbeat_ok",
    "poll",
    "health check",
    "ping",
    "keepalive",
    "monitoring",
  ],
  memory: ["memory", "remember", "recall", "notes", "journal", "log", "context"],
  // Communication channels
  Slack: ["slack", "channel", "#cc-", "thread", "mention", "dm", "workspace"],
  email: ["email", "mail", "inbox", "gmail", "send email", "unread", "compose"],
  calendar: ["calendar", "event", "meeting", "appointment", "schedule", "gcal"],
  // Development topics
  coding: [
    "code",
    "script",
    "function",
    "debug",
    "error",
    "bug",
    "implement",
    "refactor",
    "programming",
  ],
  git: [
    "git",
    "commit",
    "branch",
    "merge",
    "push",
    "pull",
    "repository",
    "pr",
    "pull request",
    "github",
  ],
  "file editing": ["file", "edit", "write", "read", "create", "delete", "modify", "save"],
  API: ["api", "endpoint", "request", "response", "webhook", "integration", "rest", "graphql"],
  // Research & web
  research: ["search", "research", "lookup", "find", "investigate", "learn", "study"],
  browser: ["browser", "webpage", "website", "url", "click", "navigate", "screenshot", "web_fetch"],
  "Quip export": ["quip", "export", "document", "spreadsheet"],
  // Domain-specific
  finance: ["finance", "investment", "stock", "money", "budget", "bank", "trading", "portfolio"],
  home: ["home", "automation", "lights", "thermostat", "smart home", "iot", "homekit"],
  health: ["health", "fitness", "workout", "exercise", "weight", "sleep", "nutrition"],
  travel: ["travel", "flight", "hotel", "trip", "vacation", "booking", "airport"],
  food: ["food", "recipe", "restaurant", "cooking", "meal", "order", "delivery"],
  // Agent operations
  subagent: ["subagent", "spawn", "sub-agent", "delegate", "worker", "parallel"],
  tools: ["tool", "exec", "shell", "command", "terminal", "bash", "run"],
};
function detectTopics(text) {
  if (!text) return [];
  const lowerText = text.toLowerCase();
  const scores = {};
  for (const [topic, keywords] of Object.entries(TOPIC_PATTERNS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (keyword.length <= 3) {
        const regex = new RegExp(`\\b${keyword}\\b`, "i");
        if (regex.test(lowerText)) score++;
      } else if (lowerText.includes(keyword)) {
        score++;
      }
    }
    if (score > 0) {
      scores[topic] = score;
    }
  }
  if (Object.keys(scores).length === 0) return [];
  const bestScore = Math.max(...Object.values(scores));
  const threshold = Math.max(2, bestScore * 0.5);
  return Object.entries(scores)
    .filter(([_, score]) => score >= threshold || (score >= 1 && bestScore <= 2))
    .sort((a, b) => b[1] - a[1])
    .map(([topic, _]) => topic);
}
var CHANNEL_MAP = {
  c0aax7y80np: "#cc-meta",
  c0ab9f8sdfe: "#cc-research",
  c0aan4rq7v5: "#cc-finance",
  c0abxulk1qq: "#cc-properties",
  c0ab5nz8mkl: "#cc-ai",
  c0aan38tzv5: "#cc-dev",
  c0ab7wwhqvc: "#cc-home",
  c0ab1pjhxef: "#cc-health",
  c0ab7txvcqd: "#cc-legal",
  c0aay2g3n3r: "#cc-social",
  c0aaxrw2wqp: "#cc-business",
  c0ab19f3lae: "#cc-random",
  c0ab0r74y33: "#cc-food",
  c0ab0qrq3r9: "#cc-travel",
  c0ab0sbqqlg: "#cc-family",
  c0ab0slqdba: "#cc-games",
  c0ab1ps7ef2: "#cc-music",
  c0absbnrsbe: "#cc-dashboard",
};
function parseSessionLabel(key) {
  const parts = key.split(":");
  if (parts.includes("slack")) {
    const channelIdx = parts.indexOf("channel");
    if (channelIdx >= 0 && parts[channelIdx + 1]) {
      const channelId = parts[channelIdx + 1].toLowerCase();
      const channelName = CHANNEL_MAP[channelId] || `#${channelId}`;
      if (parts.includes("thread")) {
        const threadTs = parts[parts.indexOf("thread") + 1];
        const ts = parseFloat(threadTs);
        const date = new Date(ts * 1e3);
        const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        return `${channelName} thread @ ${timeStr}`;
      }
      return channelName;
    }
  }
  if (key.includes("telegram")) {
    return "\u{1F4F1} Telegram";
  }
  if (key === "agent:main:main") {
    return "\u{1F3E0} Main Session";
  }
  return key.length > 40 ? key.slice(0, 37) + "..." : key;
}
function getSessionTopic(sessionId) {
  if (!sessionId) return null;
  try {
    const openclawDir = getOpenClawDir();
    const transcriptPath = path.join(
      openclawDir,
      "agents",
      "main",
      "sessions",
      `${sessionId}.jsonl`,
    );
    if (!fs.existsSync(transcriptPath)) return null;
    const fd = fs.openSync(transcriptPath, "r");
    const buffer = Buffer.alloc(5e4);
    const bytesRead = fs.readSync(fd, buffer, 0, 5e4, 0);
    fs.closeSync(fd);
    if (bytesRead === 0) return null;
    const content = buffer.toString("utf8", 0, bytesRead);
    const lines = content.split("\n").filter((l) => l.trim());
    let textSamples = [];
    for (const line of lines.slice(0, 30)) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === "message" && entry.message?.content) {
          const msgContent = entry.message.content;
          if (Array.isArray(msgContent)) {
            msgContent.forEach((c) => {
              if (c.type === "text" && c.text) {
                textSamples.push(c.text.slice(0, 500));
              }
            });
          } else if (typeof msgContent === "string") {
            textSamples.push(msgContent.slice(0, 500));
          }
        }
      } catch (e) {}
    }
    if (textSamples.length === 0) return null;
    const topics = detectTopics(textSamples.join(" "));
    return topics.length > 0 ? topics.slice(0, 2).join(", ") : null;
  } catch (e) {
    return null;
  }
}
function getSessions(options = {}) {
  const limit = Object.prototype.hasOwnProperty.call(options, "limit") ? options.limit : 20;
  const returnCount = options.returnCount || false;
  if (limit === null) {
    const cached = getSessionsCached();
    const totalCount = cached.length;
    return returnCount ? { sessions: cached, totalCount } : cached;
  }
  try {
    const output = runOpenClaw("sessions list --json 2>/dev/null");
    const jsonStr = extractJSON(output);
    if (jsonStr) {
      const data = JSON.parse(jsonStr);
      const totalCount = data.count || data.sessions?.length || 0;
      let sessions = data.sessions || [];
      if (limit != null) {
        sessions = sessions.slice(0, limit);
      }
      const mapped = sessions.map((s) => mapSession(s));
      return returnCount ? { sessions: mapped, totalCount } : mapped;
    }
  } catch (e) {
    console.error("Failed to get sessions:", e.message);
  }
  return returnCount ? { sessions: [], totalCount: 0 } : [];
}
function cronToHuman(expr) {
  if (!expr || expr === "\u2014") return null;
  const parts = expr.split(" ");
  if (parts.length < 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  function formatTime(h, m) {
    const hNum = parseInt(h, 10);
    const mNum = parseInt(m, 10);
    if (isNaN(hNum)) return null;
    const ampm = hNum >= 12 ? "pm" : "am";
    const h12 = hNum === 0 ? 12 : hNum > 12 ? hNum - 12 : hNum;
    return mNum === 0 ? `${h12}${ampm}` : `${h12}:${mNum.toString().padStart(2, "0")}${ampm}`;
  }
  if (minute === "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return "Every minute";
  }
  if (minute.startsWith("*/")) {
    const interval = minute.slice(2);
    return `Every ${interval} minutes`;
  }
  if (hour.startsWith("*/")) {
    const interval = hour.slice(2);
    const minStr = minute === "0" ? "" : `:${minute.padStart(2, "0")}`;
    return `Every ${interval} hours${minStr ? " at " + minStr : ""}`;
  }
  if (minute !== "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Hourly at :${minute.padStart(2, "0")}`;
  }
  let timeStr = "";
  if (minute !== "*" && hour !== "*" && !hour.startsWith("*/")) {
    timeStr = formatTime(hour, minute);
  }
  if (timeStr && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Daily at ${timeStr}`;
  }
  if ((dayOfWeek === "1-5" || dayOfWeek === "MON-FRI") && dayOfMonth === "*" && month === "*") {
    return timeStr ? `Weekdays at ${timeStr}` : "Weekdays";
  }
  if ((dayOfWeek === "0,6" || dayOfWeek === "6,0") && dayOfMonth === "*" && month === "*") {
    return timeStr ? `Weekends at ${timeStr}` : "Weekends";
  }
  if (dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
    const days = dayOfWeek.split(",").map((d) => {
      const num = parseInt(d, 10);
      return dayNames[num] || d;
    });
    const dayStr = days.length === 1 ? days[0] : days.join(", ");
    return timeStr ? `${dayStr} at ${timeStr}` : `Every ${dayStr}`;
  }
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
  if (timeStr) {
    return `At ${timeStr}`;
  }
  return expr;
}
function getCronJobs() {
  try {
    const cronPath = path.join(getOpenClawDir(), "cron", "jobs.json");
    if (fs.existsSync(cronPath)) {
      const data = JSON.parse(fs.readFileSync(cronPath, "utf8"));
      return (data.jobs || []).map((j) => {
        let scheduleStr = "\u2014";
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
        let nextRunStr = "\u2014";
        if (j.state?.nextRunAtMs) {
          const next = new Date(j.state.nextRunAtMs);
          const now = /* @__PURE__ */ new Date();
          const diffMs = next - now;
          const diffMins = Math.round(diffMs / 6e4);
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
          scheduleHuman,
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
function getSystemStatus() {
  const hostname = execSync("hostname", { encoding: "utf8" }).trim();
  let uptime = "\u2014";
  try {
    const uptimeRaw = execSync("uptime", { encoding: "utf8" });
    const match = uptimeRaw.match(/up\s+([^,]+)/);
    if (match) uptime = match[1].trim();
  } catch (e) {}
  let gateway = "Unknown";
  try {
    const status = runOpenClaw("gateway status 2>/dev/null");
    if (status && status.includes("running")) {
      gateway = "Running";
    } else if (status && status.includes("stopped")) {
      gateway = "Stopped";
    }
  } catch (e) {}
  return {
    hostname,
    gateway,
    model: "claude-opus-4-5",
    uptime,
  };
}
function getRecentActivity() {
  const activities = [];
  const today = /* @__PURE__ */ new Date().toISOString().split("T")[0];
  const memoryFile = path.join(PATHS.memory, `${today}.md`);
  try {
    if (fs.existsSync(memoryFile)) {
      const content = fs.readFileSync(memoryFile, "utf8");
      const lines = content.split("\n").filter((l) => l.startsWith("- "));
      lines.slice(-5).forEach((line) => {
        const text = line.replace(/^- /, "").slice(0, 80);
        activities.push({
          icon: text.includes("\u2705")
            ? "\u2705"
            : text.includes("\u274C")
              ? "\u274C"
              : "\u{1F4DD}",
          text: text.replace(/[✅❌📝🔧]/g, "").trim(),
          time: today,
        });
      });
    }
  } catch (e) {
    console.error("Failed to read activity:", e.message);
  }
  return activities.reverse();
}
function getCapacity() {
  const result = {
    main: { active: 0, max: 12 },
    subagent: { active: 0, max: 24 },
  };
  const openclawDir = getOpenClawDir();
  try {
    const configPath = path.join(openclawDir, "openclaw.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (config?.agents?.defaults?.maxConcurrent) {
        result.main.max = config.agents.defaults.maxConcurrent;
      }
      if (config?.agents?.defaults?.subagents?.maxConcurrent) {
        result.subagent.max = config.agents.defaults.subagents.maxConcurrent;
      }
    }
  } catch (e) {}
  try {
    const output = runOpenClaw("sessions list --json 2>/dev/null");
    const jsonStr = extractJSON(output);
    if (jsonStr) {
      const data = JSON.parse(jsonStr);
      const sessions = data.sessions || [];
      const fiveMinMs = 5 * 60 * 1e3;
      for (const s of sessions) {
        if (s.ageMs > fiveMinMs) continue;
        const key = s.key || "";
        if (key.includes(":subagent:") || key.includes(":cron:")) {
          result.subagent.active++;
        } else {
          result.main.active++;
        }
      }
      return result;
    }
  } catch (e) {
    console.error(
      "Failed to get capacity from sessions list, falling back to filesystem:",
      e.message,
    );
  }
  try {
    const sessionsDir = path.join(openclawDir, "agents", "main", "sessions");
    if (fs.existsSync(sessionsDir)) {
      const fiveMinAgo = Date.now() - 5 * 60 * 1e3;
      const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
      let mainActive = 0;
      let subActive = 0;
      for (const file of files) {
        try {
          const filePath = path.join(sessionsDir, file);
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < fiveMinAgo) continue;
          let isSubagent = false;
          try {
            const fd = fs.openSync(filePath, "r");
            const buffer = Buffer.alloc(512);
            fs.readSync(fd, buffer, 0, 512, 0);
            fs.closeSync(fd);
            const firstLine = buffer.toString("utf8").split("\n")[0];
            const parsed = JSON.parse(firstLine);
            const key = parsed.key || parsed.id || "";
            isSubagent = key.includes(":subagent:") || key.includes(":cron:");
          } catch (parseErr) {
            isSubagent = file.includes("subagent");
          }
          if (isSubagent) {
            subActive++;
          } else {
            mainActive++;
          }
        } catch (e) {}
      }
      result.main.active = mainActive;
      result.subagent.active = subActive;
    }
  } catch (e) {
    console.error("Failed to count active sessions from filesystem:", e.message);
  }
  return result;
}
function getMemoryStats() {
  const memoryDir = PATHS.memory;
  const memoryFile = path.join(PATHS.workspace, "MEMORY.md");
  const stats = {
    totalFiles: 0,
    totalSize: 0,
    totalSizeFormatted: "0 B",
    memoryMdSize: 0,
    memoryMdSizeFormatted: "0 B",
    memoryMdLines: 0,
    recentFiles: [],
    oldestFile: null,
    newestFile: null,
  };
  try {
    const collectMemoryFiles = (dir, baseDir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files = [];
      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...collectMemoryFiles(entryPath, baseDir));
        } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".json"))) {
          const stat = fs.statSync(entryPath);
          const relativePath = path.relative(baseDir, entryPath);
          files.push({
            name: relativePath,
            size: stat.size,
            sizeFormatted: formatBytes(stat.size),
            modified: stat.mtime,
          });
        }
      }
      return files;
    };
    if (fs.existsSync(memoryFile)) {
      const memStat = fs.statSync(memoryFile);
      stats.memoryMdSize = memStat.size;
      stats.memoryMdSizeFormatted = formatBytes(memStat.size);
      const content = fs.readFileSync(memoryFile, "utf8");
      stats.memoryMdLines = content.split("\n").length;
      stats.totalSize += memStat.size;
      stats.totalFiles++;
    }
    if (fs.existsSync(memoryDir)) {
      const files = collectMemoryFiles(memoryDir, memoryDir).sort(
        (a, b) => b.modified - a.modified,
      );
      stats.totalFiles += files.length;
      files.forEach((f) => (stats.totalSize += f.size));
      stats.recentFiles = files.slice(0, 5).map((f) => ({
        name: f.name,
        sizeFormatted: f.sizeFormatted,
        age: formatTimeAgo(f.modified),
      }));
      if (files.length > 0) {
        stats.newestFile = files[0].name;
        stats.oldestFile = files[files.length - 1].name;
      }
    }
    stats.totalSizeFormatted = formatBytes(stats.totalSize);
  } catch (e) {
    console.error("Failed to get memory stats:", e.message);
  }
  return stats;
}
var cachedState = null;
var lastStateUpdate = 0;
var STATE_CACHE_TTL = 3e4;
function getFullState() {
  const now = Date.now();
  if (cachedState && now - lastStateUpdate < STATE_CACHE_TTL) {
    return cachedState;
  }
  let sessions = [];
  let tokenStats = {};
  let statusCounts = { all: 0, live: 0, recent: 0, idle: 0 };
  let vitals = {};
  let capacity = {};
  let operators = { operators: [], roles: {} };
  let llmUsage = {};
  let cron = [];
  let memory = {};
  let cerebro = {};
  let subagents = [];
  let allSessions = [];
  let totalSessionCount = 0;
  try {
    allSessions = getSessions({ limit: null });
    totalSessionCount = allSessions.length;
    sessions = allSessions.slice(0, 20);
  } catch (e) {
    console.error("[State] sessions:", e.message);
  }
  try {
    vitals = getSystemVitals();
  } catch (e) {
    console.error("[State] vitals:", e.message);
  }
  try {
    capacity = getCapacity();
  } catch (e) {
    console.error("[State] capacity:", e.message);
  }
  try {
    tokenStats = getTokenStats(sessions, capacity);
  } catch (e) {
    console.error("[State] tokenStats:", e.message);
  }
  try {
    const liveSessions = allSessions.filter((s) => s.active);
    const recentSessions = allSessions.filter((s) => !s.active && s.recentlyActive);
    const idleSessions = allSessions.filter((s) => !s.active && !s.recentlyActive);
    statusCounts = {
      all: totalSessionCount,
      live: liveSessions.length,
      recent: recentSessions.length,
      idle: idleSessions.length,
    };
  } catch (e) {
    console.error("[State] statusCounts:", e.message);
  }
  try {
    const operatorData = loadOperators();
    const operatorsWithStats = operatorData.operators.map((op) => {
      const userSessions = allSessions.filter(
        (s) => s.originator?.userId === op.id || s.originator?.userId === op.metadata?.slackId,
      );
      return {
        ...op,
        stats: {
          activeSessions: userSessions.filter((s) => s.active).length,
          totalSessions: userSessions.length,
          lastSeen:
            userSessions.length > 0
              ? new Date(
                  Date.now() - Math.min(...userSessions.map((s) => s.minutesAgo)) * 6e4,
                ).toISOString()
              : op.lastSeen,
        },
      };
    });
    operators = { ...operatorData, operators: operatorsWithStats };
  } catch (e) {
    console.error("[State] operators:", e.message);
  }
  try {
    llmUsage = getLlmUsage();
  } catch (e) {
    console.error("[State] llmUsage:", e.message);
  }
  try {
    cron = getCronJobs();
  } catch (e) {
    console.error("[State] cron:", e.message);
  }
  try {
    memory = getMemoryStats();
  } catch (e) {
    console.error("[State] memory:", e.message);
  }
  try {
    cerebro = getCerebroTopics();
  } catch (e) {
    console.error("[State] cerebro:", e.message);
  }
  try {
    const retentionHours = parseInt(process.env.SUBAGENT_RETENTION_HOURS || "12", 10);
    const retentionMs = retentionHours * 60 * 60 * 1e3;
    subagents = allSessions
      .filter((s) => s.sessionKey && s.sessionKey.includes(":subagent:"))
      .filter((s) => (s.minutesAgo || 0) * 6e4 < retentionMs)
      .map((s) => {
        const match = s.sessionKey.match(/:subagent:([a-f0-9-]+)$/);
        const subagentId = match ? match[1] : s.sessionId;
        return {
          id: subagentId,
          shortId: subagentId.slice(0, 8),
          task: s.label || s.displayName || "Sub-agent task",
          tokens: s.tokens || 0,
          ageMs: (s.minutesAgo || 0) * 6e4,
          active: s.active,
          recentlyActive: s.recentlyActive,
        };
      });
  } catch (e) {
    console.error("[State] subagents:", e.message);
  }
  cachedState = {
    vitals,
    sessions,
    tokenStats,
    statusCounts,
    capacity,
    operators,
    llmUsage,
    cron,
    memory,
    cerebro,
    subagents,
    pagination: {
      page: 1,
      pageSize: 20,
      total: totalSessionCount,
      totalPages: Math.max(1, Math.ceil(totalSessionCount / 20)),
      hasPrev: false,
      hasNext: totalSessionCount > 20,
    },
    timestamp: now,
  };
  lastStateUpdate = now;
  return cachedState;
}
function refreshState() {
  lastStateUpdate = 0;
  return getFullState();
}
var tokenUsageCache = { data: null, timestamp: 0, refreshing: false };
var TOKEN_USAGE_CACHE_TTL = 3e4;
function emptyUsageBucket() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, requests: 0 };
}
async function refreshTokenUsageAsync() {
  if (tokenUsageCache.refreshing) return;
  tokenUsageCache.refreshing = true;
  try {
    const sessionsDir = path.join(getOpenClawDir(), "agents", "main", "sessions");
    const files = await fs.promises.readdir(sessionsDir);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1e3;
    const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1e3;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1e3;
    const usage24h = emptyUsageBucket();
    const usage3d = emptyUsageBucket();
    const usage7d = emptyUsageBucket();
    const batchSize = 50;
    for (let i = 0; i < jsonlFiles.length; i += batchSize) {
      const batch = jsonlFiles.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (file) => {
          const filePath = path.join(sessionsDir, file);
          try {
            const stat = await fs.promises.stat(filePath);
            if (stat.mtimeMs < sevenDaysAgo) return;
            const content = await fs.promises.readFile(filePath, "utf8");
            const lines = content.trim().split("\n");
            for (const line of lines) {
              if (!line) continue;
              try {
                const entry = JSON.parse(line);
                const entryTime = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
                if (entryTime < sevenDaysAgo) continue;
                if (entry.message?.usage) {
                  const u = entry.message.usage;
                  const input = u.input || 0;
                  const output = u.output || 0;
                  const cacheRead = u.cacheRead || 0;
                  const cacheWrite = u.cacheWrite || 0;
                  const cost = u.cost?.total || 0;
                  if (entryTime >= oneDayAgo) {
                    usage24h.input += input;
                    usage24h.output += output;
                    usage24h.cacheRead += cacheRead;
                    usage24h.cacheWrite += cacheWrite;
                    usage24h.cost += cost;
                    usage24h.requests++;
                  }
                  if (entryTime >= threeDaysAgo) {
                    usage3d.input += input;
                    usage3d.output += output;
                    usage3d.cacheRead += cacheRead;
                    usage3d.cacheWrite += cacheWrite;
                    usage3d.cost += cost;
                    usage3d.requests++;
                  }
                  usage7d.input += input;
                  usage7d.output += output;
                  usage7d.cacheRead += cacheRead;
                  usage7d.cacheWrite += cacheWrite;
                  usage7d.cost += cost;
                  usage7d.requests++;
                }
              } catch (e) {}
            }
          } catch (e) {}
        }),
      );
      await new Promise((resolve) => setImmediate(resolve));
    }
    const finalizeBucket = (bucket) => ({
      ...bucket,
      tokensNoCache: bucket.input + bucket.output,
      tokensWithCache: bucket.input + bucket.output + bucket.cacheRead + bucket.cacheWrite,
    });
    const result = {
      // Primary (24h) for backward compatibility
      ...finalizeBucket(usage24h),
      // All three windows
      windows: {
        "24h": finalizeBucket(usage24h),
        "3d": finalizeBucket(usage3d),
        "7d": finalizeBucket(usage7d),
      },
    };
    tokenUsageCache = { data: result, timestamp: Date.now(), refreshing: false };
    console.log(
      `[Token Usage] Cached: 24h=${usage24h.requests} 3d=${usage3d.requests} 7d=${usage7d.requests} requests`,
    );
  } catch (e) {
    console.error("[Token Usage] Refresh error:", e.message);
    tokenUsageCache.refreshing = false;
  }
}
function getDailyTokenUsage() {
  const now = Date.now();
  const isStale = now - tokenUsageCache.timestamp > TOKEN_USAGE_CACHE_TTL;
  if (isStale && !tokenUsageCache.refreshing) {
    refreshTokenUsageAsync();
  }
  const emptyResult = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    requests: 0,
    tokensNoCache: 0,
    tokensWithCache: 0,
    windows: {
      "24h": {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
        requests: 0,
        tokensNoCache: 0,
        tokensWithCache: 0,
      },
      "3d": {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
        requests: 0,
        tokensNoCache: 0,
        tokensWithCache: 0,
      },
      "7d": {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
        requests: 0,
        tokensNoCache: 0,
        tokensWithCache: 0,
      },
    },
  };
  return tokenUsageCache.data || emptyResult;
}
var TOKEN_RATES = {
  input: 15,
  // $15/1M input tokens
  output: 75,
  // $75/1M output tokens
  cacheRead: 1.5,
  // $1.50/1M (90% discount from input)
  cacheWrite: 18.75,
  // $18.75/1M (25% premium on input)
};
function calculateCostForBucket(bucket, rates = TOKEN_RATES) {
  const inputCost = (bucket.input / 1e6) * rates.input;
  const outputCost = (bucket.output / 1e6) * rates.output;
  const cacheReadCost = (bucket.cacheRead / 1e6) * rates.cacheRead;
  const cacheWriteCost = (bucket.cacheWrite / 1e6) * rates.cacheWrite;
  return {
    inputCost,
    outputCost,
    cacheReadCost,
    cacheWriteCost,
    totalCost: inputCost + outputCost + cacheReadCost + cacheWriteCost,
  };
}
function getCostBreakdown() {
  const usage = getDailyTokenUsage();
  if (!usage) {
    return { error: "Failed to get usage data" };
  }
  const costs = calculateCostForBucket(usage);
  const planCost = CONFIG.billing?.claudePlanCost || 200;
  const planName = CONFIG.billing?.claudePlanName || "Claude Code Max";
  const windowConfigs = {
    "24h": { days: 1, label: "24h" },
    "3d": { days: 3, label: "3dma" },
    "7d": { days: 7, label: "7dma" },
  };
  const windows = {};
  for (const [key, config] of Object.entries(windowConfigs)) {
    const bucket = usage.windows?.[key] || usage;
    const bucketCosts = calculateCostForBucket(bucket);
    const dailyAvg = bucketCosts.totalCost / config.days;
    const monthlyProjected = dailyAvg * 30;
    const monthlySavings = monthlyProjected - planCost;
    windows[key] = {
      label: config.label,
      days: config.days,
      totalCost: bucketCosts.totalCost,
      dailyAvg,
      monthlyProjected,
      monthlySavings,
      savingsPercent:
        monthlySavings > 0 ? Math.round((monthlySavings / monthlyProjected) * 100) : 0,
      requests: bucket.requests,
      tokens: {
        input: bucket.input,
        output: bucket.output,
        cacheRead: bucket.cacheRead,
        cacheWrite: bucket.cacheWrite,
      },
    };
  }
  return {
    // Raw token counts (24h for backward compatibility)
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    requests: usage.requests,
    // Pricing rates
    rates: {
      input: TOKEN_RATES.input.toFixed(2),
      output: TOKEN_RATES.output.toFixed(2),
      cacheRead: TOKEN_RATES.cacheRead.toFixed(2),
      cacheWrite: TOKEN_RATES.cacheWrite.toFixed(2),
    },
    // Cost calculation breakdown (24h)
    calculation: {
      inputCost: costs.inputCost,
      outputCost: costs.outputCost,
      cacheReadCost: costs.cacheReadCost,
      cacheWriteCost: costs.cacheWriteCost,
    },
    // Totals (24h for backward compatibility)
    totalCost: costs.totalCost,
    planCost,
    planName,
    // Period
    period: "24 hours",
    // Multi-window data for moving averages
    windows,
    // Top sessions by tokens
    topSessions: getTopSessionsByTokens(5),
  };
}
function getTopSessionsByTokens(limit = 5) {
  try {
    const sessions = getSessions({ limit: null });
    return sessions
      .filter((s) => s.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, limit)
      .map((s) => ({
        label: s.label,
        tokens: s.tokens,
        channel: s.channel,
        active: s.active,
      }));
  } catch (e) {
    console.error("[TopSessions] Error:", e.message);
    return [];
  }
}
function getTokenStats(sessions, capacity) {
  let activeMainCount = capacity?.main?.active ?? 0;
  let activeSubagentCount = capacity?.subagent?.active ?? 0;
  let activeCount = activeMainCount + activeSubagentCount;
  let mainLimit = capacity?.main?.max ?? 12;
  let subagentLimit = capacity?.subagent?.max ?? 24;
  if (!capacity && sessions && sessions.length > 0) {
    activeCount = 0;
    activeMainCount = 0;
    activeSubagentCount = 0;
    sessions.forEach((s) => {
      if (s.active) {
        activeCount++;
        if (s.key && s.key.includes(":subagent:")) {
          activeSubagentCount++;
        } else {
          activeMainCount++;
        }
      }
    });
  }
  const usage = getDailyTokenUsage();
  const totalInput = usage?.input || 0;
  const totalOutput = usage?.output || 0;
  const total = totalInput + totalOutput;
  const costs = calculateCostForBucket(usage);
  const estCost = costs.totalCost;
  const planCost = CONFIG.billing?.claudePlanCost || 200;
  const planName = CONFIG.billing?.claudePlanName || "Claude Code Max";
  const monthlyApiCost = estCost * 30;
  const monthlySavings = monthlyApiCost - planCost;
  const savingsPositive = monthlySavings > 0;
  const sessionCount = sessions?.length || 1;
  const avgTokensPerSession = Math.round(total / sessionCount);
  const avgCostPerSession = estCost / sessionCount;
  const windowConfigs = {
    "24h": { days: 1, label: "24h" },
    "3dma": { days: 3, label: "3dma" },
    "7dma": { days: 7, label: "7dma" },
  };
  const savingsWindows = {};
  for (const [key, config] of Object.entries(windowConfigs)) {
    const bucketKey = key.replace("dma", "d").replace("24h", "24h");
    const bucket = usage.windows?.[bucketKey === "24h" ? "24h" : bucketKey] || usage;
    const bucketCosts = calculateCostForBucket(bucket);
    const dailyAvg = bucketCosts.totalCost / config.days;
    const monthlyProjected = dailyAvg * 30;
    const windowSavings = monthlyProjected - planCost;
    const windowSavingsPositive = windowSavings > 0;
    savingsWindows[key] = {
      label: config.label,
      estCost: `$${formatNumber(dailyAvg)}`,
      estMonthlyCost: `$${Math.round(monthlyProjected).toLocaleString()}`,
      estSavings: windowSavingsPositive ? `$${formatNumber(windowSavings)}/mo` : null,
      savingsPercent: windowSavingsPositive
        ? Math.round((windowSavings / monthlyProjected) * 100)
        : 0,
      requests: bucket.requests,
    };
  }
  return {
    total: formatTokens(total),
    input: formatTokens(totalInput),
    output: formatTokens(totalOutput),
    cacheRead: formatTokens(usage?.cacheRead || 0),
    cacheWrite: formatTokens(usage?.cacheWrite || 0),
    requests: usage?.requests || 0,
    activeCount,
    activeMainCount,
    activeSubagentCount,
    mainLimit,
    subagentLimit,
    estCost: `$${formatNumber(estCost)}`,
    planCost: `$${planCost.toFixed(0)}`,
    planName,
    // 24h savings (backward compatible)
    estSavings: savingsPositive ? `$${formatNumber(monthlySavings)}/mo` : null,
    savingsPercent: savingsPositive ? Math.round((monthlySavings / monthlyApiCost) * 100) : 0,
    estMonthlyCost: `$${Math.round(monthlyApiCost).toLocaleString()}`,
    // Multi-window savings (24h, 3da, 7da)
    savingsWindows,
    // Per-session averages
    avgTokensPerSession: formatTokens(avgTokensPerSession),
    avgCostPerSession: `$${avgCostPerSession.toFixed(2)}`,
    sessionCount,
  };
}
function handleApi(req, res) {
  const sessions = getSessions();
  const tokenStats = getTokenStats(sessions);
  const capacity = getCapacity();
  const data = {
    sessions,
    cron: getCronJobs(),
    system: getSystemStatus(),
    activity: getRecentActivity(),
    tokenStats,
    capacity,
    timestamp: /* @__PURE__ */ new Date().toISOString(),
  };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}
function readTranscript(sessionId) {
  const openclawDir = getOpenClawDir();
  const transcriptPath = path.join(openclawDir, "agents", "main", "sessions", `${sessionId}.jsonl`);
  try {
    if (!fs.existsSync(transcriptPath)) return [];
    const content = fs.readFileSync(transcriptPath, "utf8");
    return content
      .trim()
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (e) {
    console.error("Failed to read transcript:", e.message);
    return [];
  }
}
function getSessionDetail(sessionKey) {
  try {
    const listOutput = runOpenClaw("sessions list --json 2>/dev/null");
    let sessionInfo = null;
    const jsonStr = extractJSON(listOutput);
    if (jsonStr) {
      const data = JSON.parse(jsonStr);
      sessionInfo = data.sessions?.find((s) => s.key === sessionKey);
    }
    if (!sessionInfo) {
      return { error: "Session not found" };
    }
    const transcript = readTranscript(sessionInfo.sessionId);
    let messages = [];
    let tools = {};
    let facts = [];
    let needsAttention = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let totalCost = 0;
    let detectedModel = sessionInfo.model || null;
    transcript.forEach((entry) => {
      if (entry.type !== "message" || !entry.message) return;
      const msg = entry.message;
      if (!msg.role) return;
      if (msg.usage) {
        totalInputTokens += msg.usage.input || msg.usage.inputTokens || 0;
        totalOutputTokens += msg.usage.output || msg.usage.outputTokens || 0;
        totalCacheRead += msg.usage.cacheRead || msg.usage.cacheReadTokens || 0;
        totalCacheWrite += msg.usage.cacheWrite || msg.usage.cacheWriteTokens || 0;
        if (msg.usage.cost?.total) totalCost += msg.usage.cost.total;
      }
      if (msg.role === "assistant" && msg.model && !detectedModel) {
        detectedModel = msg.model;
      }
      let text = "";
      if (typeof msg.content === "string") {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        const textPart = msg.content.find((c) => c.type === "text");
        if (textPart) text = textPart.text || "";
        msg.content
          .filter((c) => c.type === "toolCall" || c.type === "tool_use")
          .forEach((tc) => {
            const name = tc.name || tc.tool || "unknown";
            tools[name] = (tools[name] || 0) + 1;
          });
      }
      if (text && msg.role !== "toolResult") {
        messages.push({ role: msg.role, text, timestamp: entry.timestamp });
      }
      if (msg.role === "user" && text) {
        const lowerText = text.toLowerCase();
        if (text.includes("?")) {
          const questions = text.match(/[^.!?\n]*\?/g) || [];
          questions.slice(0, 2).forEach((q) => {
            if (q.length > 15 && q.length < 200) {
              needsAttention.push(`\u2753 ${q.trim()}`);
            }
          });
        }
        if (
          lowerText.includes("todo") ||
          lowerText.includes("remind") ||
          lowerText.includes("need to")
        ) {
          const match = text.match(/(?:todo|remind|need to)[^.!?\n]*/i);
          if (match) needsAttention.push(`\u{1F4CB} ${match[0].slice(0, 100)}`);
        }
      }
      if (msg.role === "assistant" && text) {
        const lowerText = text.toLowerCase();
        ["\u2705", "done", "created", "updated", "fixed", "deployed"].forEach((keyword) => {
          if (lowerText.includes(keyword)) {
            const lines = text.split("\n").filter((l) => l.toLowerCase().includes(keyword));
            lines.slice(0, 2).forEach((line) => {
              if (line.length > 5 && line.length < 150) {
                facts.push(line.trim().slice(0, 100));
              }
            });
          }
        });
      }
    });
    let summary = "No activity yet.";
    const userMessages = messages.filter((m) => m.role === "user");
    const assistantMessages = messages.filter((m) => m.role === "assistant");
    let topics = [];
    if (messages.length > 0) {
      summary = `${messages.length} messages (${userMessages.length} user, ${assistantMessages.length} assistant). `;
      const allText = messages.map((m) => m.text).join(" ");
      topics = detectTopics(allText);
      if (topics.length > 0) {
        summary += `Topics: ${topics.join(", ")}.`;
      }
    }
    const toolsArray = Object.entries(tools)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    const ageMs = sessionInfo.ageMs || 0;
    const lastActive =
      ageMs < 6e4
        ? "Just now"
        : ageMs < 36e5
          ? `${Math.round(ageMs / 6e4)} minutes ago`
          : ageMs < 864e5
            ? `${Math.round(ageMs / 36e5)} hours ago`
            : `${Math.round(ageMs / 864e5)} days ago`;
    let channelDisplay = "Other";
    if (sessionInfo.groupChannel) {
      channelDisplay = sessionInfo.groupChannel;
    } else if (sessionInfo.displayName) {
      channelDisplay = sessionInfo.displayName;
    } else if (sessionKey.includes("slack")) {
      const parts = sessionKey.split(":");
      const channelIdx = parts.indexOf("channel");
      if (channelIdx >= 0 && parts[channelIdx + 1]) {
        const channelId = parts[channelIdx + 1].toLowerCase();
        channelDisplay = CHANNEL_MAP[channelId] || `#${channelId}`;
      } else {
        channelDisplay = "Slack";
      }
    } else if (sessionKey.includes("telegram")) {
      channelDisplay = "Telegram";
    }
    const finalTotalTokens = totalInputTokens + totalOutputTokens || sessionInfo.totalTokens || 0;
    const finalInputTokens = totalInputTokens || sessionInfo.inputTokens || 0;
    const finalOutputTokens = totalOutputTokens || sessionInfo.outputTokens || 0;
    const modelDisplay = (detectedModel || sessionInfo.model || "-")
      .replace("anthropic/", "")
      .replace("openai/", "");
    return {
      key: sessionKey,
      kind: sessionInfo.kind,
      channel: channelDisplay,
      groupChannel: sessionInfo.groupChannel || channelDisplay,
      model: modelDisplay,
      tokens: finalTotalTokens,
      inputTokens: finalInputTokens,
      outputTokens: finalOutputTokens,
      cacheRead: totalCacheRead,
      cacheWrite: totalCacheWrite,
      estCost: totalCost > 0 ? `$${totalCost.toFixed(4)}` : null,
      lastActive,
      summary,
      topics,
      // Array of detected topics
      facts: [...new Set(facts)].slice(0, 8),
      needsAttention: [...new Set(needsAttention)].slice(0, 5),
      tools: toolsArray.slice(0, 10),
      messages: messages
        .slice(-15)
        .reverse()
        .map((m) => ({
          role: m.role,
          text: m.text.slice(0, 500),
        })),
    };
  } catch (e) {
    console.error("Failed to get session detail:", e.message);
    return { error: e.message };
  }
}
var CEREBRO_DIR = PATHS.cerebro;
function getCerebroTopics(options = {}) {
  const { offset = 0, limit = 20, status: filterStatus = "all" } = options;
  const topicsDir = path.join(CEREBRO_DIR, "topics");
  const orphansDir = path.join(CEREBRO_DIR, "orphans");
  const topics = [];
  const result = {
    initialized: false,
    cerebroPath: CEREBRO_DIR,
    topics: { active: 0, resolved: 0, parked: 0, total: 0 },
    threads: 0,
    orphans: 0,
    recentTopics: [],
    lastUpdated: null,
  };
  try {
    if (!fs.existsSync(CEREBRO_DIR)) {
      return result;
    }
    result.initialized = true;
    let latestModified = null;
    if (!fs.existsSync(topicsDir)) {
      return result;
    }
    const topicNames = fs.readdirSync(topicsDir).filter((name) => {
      const topicPath = path.join(topicsDir, name);
      return fs.statSync(topicPath).isDirectory() && !name.startsWith("_");
    });
    topicNames.forEach((name) => {
      const topicMdPath = path.join(topicsDir, name, "topic.md");
      const topicDirPath = path.join(topicsDir, name);
      let stat;
      let content = "";
      if (fs.existsSync(topicMdPath)) {
        stat = fs.statSync(topicMdPath);
        content = fs.readFileSync(topicMdPath, "utf8");
      } else {
        stat = fs.statSync(topicDirPath);
      }
      try {
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        let title = name;
        let topicStatus = "active";
        let category = "general";
        let created = null;
        if (frontmatterMatch) {
          const frontmatter = frontmatterMatch[1];
          const titleMatch = frontmatter.match(/title:\s*(.+)/);
          const statusMatch = frontmatter.match(/status:\s*(.+)/);
          const categoryMatch = frontmatter.match(/category:\s*(.+)/);
          const createdMatch = frontmatter.match(/created:\s*(.+)/);
          if (titleMatch) title = titleMatch[1].trim();
          if (statusMatch) topicStatus = statusMatch[1].trim().toLowerCase();
          if (categoryMatch) category = categoryMatch[1].trim();
          if (createdMatch) created = createdMatch[1].trim();
        }
        const threadsDir = path.join(topicsDir, name, "threads");
        let threadCount = 0;
        if (fs.existsSync(threadsDir)) {
          threadCount = fs
            .readdirSync(threadsDir)
            .filter((f) => f.endsWith(".md") || f.endsWith(".json")).length;
        }
        result.threads += threadCount;
        if (topicStatus === "active") result.topics.active++;
        else if (topicStatus === "resolved") result.topics.resolved++;
        else if (topicStatus === "parked") result.topics.parked++;
        if (!latestModified || stat.mtime > latestModified) {
          latestModified = stat.mtime;
        }
        topics.push({
          name,
          title,
          status: topicStatus,
          category,
          created,
          threads: threadCount,
          lastModified: stat.mtimeMs,
        });
      } catch (e) {
        console.error(`Failed to parse topic ${name}:`, e.message);
      }
    });
    result.topics.total = topics.length;
    const statusPriority = { active: 0, resolved: 1, parked: 2 };
    topics.sort((a, b) => {
      const statusDiff = (statusPriority[a.status] || 3) - (statusPriority[b.status] || 3);
      if (statusDiff !== 0) return statusDiff;
      return b.lastModified - a.lastModified;
    });
    let filtered = topics;
    if (filterStatus !== "all") {
      filtered = topics.filter((t) => t.status === filterStatus);
    }
    const paginated = filtered.slice(offset, offset + limit);
    result.recentTopics = paginated.map((t) => ({
      name: t.name,
      title: t.title,
      status: t.status,
      threads: t.threads,
      age: formatTimeAgo(new Date(t.lastModified)),
    }));
    if (fs.existsSync(orphansDir)) {
      try {
        result.orphans = fs.readdirSync(orphansDir).filter((f) => f.endsWith(".md")).length;
      } catch (e) {}
    }
    result.lastUpdated = latestModified ? latestModified.toISOString() : null;
  } catch (e) {
    console.error("Failed to get Cerebro topics:", e.message);
  }
  return result;
}
function updateTopicStatus(topicId, newStatus) {
  const topicDir = path.join(CEREBRO_DIR, "topics", topicId);
  const topicFile = path.join(topicDir, "topic.md");
  if (!fs.existsSync(topicDir)) {
    return { error: `Topic '${topicId}' not found`, code: 404 };
  }
  if (!fs.existsSync(topicFile)) {
    const content2 = `---
title: ${topicId}
status: ${newStatus}
category: general
created: ${/* @__PURE__ */ new Date().toISOString().split("T")[0]}
---

# ${topicId}

## Overview
*Topic tracking file.*

## Notes
`;
    fs.writeFileSync(topicFile, content2, "utf8");
    return {
      topic: {
        id: topicId,
        name: topicId,
        title: topicId,
        status: newStatus,
      },
    };
  }
  let content = fs.readFileSync(topicFile, "utf8");
  let title = topicId;
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    let frontmatter = frontmatterMatch[1];
    const titleMatch = frontmatter.match(/title:\s*["']?([^"'\n]+)["']?/i);
    if (titleMatch) title = titleMatch[1];
    if (frontmatter.includes("status:")) {
      frontmatter = frontmatter.replace(
        /status:\s*(active|resolved|parked)/i,
        `status: ${newStatus}`,
      );
    } else {
      frontmatter =
        frontmatter.trim() +
        `
status: ${newStatus}`;
    }
    content = content.replace(
      /^---\n[\s\S]*?\n---/,
      `---
${frontmatter}
---`,
    );
  } else {
    const headerMatch = content.match(/^#\s*(.+)/m);
    if (headerMatch) title = headerMatch[1];
    const frontmatter = `---
title: ${title}
status: ${newStatus}
category: general
created: ${/* @__PURE__ */ new Date().toISOString().split("T")[0]}
---

`;
    content = frontmatter + content;
  }
  fs.writeFileSync(topicFile, content, "utf8");
  return {
    topic: {
      id: topicId,
      name: topicId,
      title,
      status: newStatus,
    },
  };
}
function serveStatic(req, res) {
  let filePath = req.url === "/" ? "/index.html" : req.url;
  filePath = path.join(DASHBOARD_DIR, filePath);
  const ext = path.extname(filePath);
  const contentTypes = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
  };
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentTypes[ext] || "text/plain" });
    res.end(content);
  });
}
var llmUsageCache = { data: null, timestamp: 0, refreshing: false };
var LLM_CACHE_TTL_MS = 6e4;
function refreshLlmUsageAsync() {
  if (llmUsageCache.refreshing) return;
  llmUsageCache.refreshing = true;
  const profile = process.env.OPENCLAW_PROFILE || "";
  const profileFlag = profile ? ` --profile ${profile}` : "";
  exec(
    `openclaw${profileFlag} status --usage --json`,
    { encoding: "utf8", timeout: 2e4 },
    (err, stdout) => {
      llmUsageCache.refreshing = false;
      if (err) {
        console.error("[LLM Usage] Async refresh failed:", err.message);
        return;
      }
      try {
        const jsonStart = stdout.indexOf("{");
        const jsonStr = jsonStart >= 0 ? stdout.slice(jsonStart) : stdout;
        const parsed = JSON.parse(jsonStr);
        if (parsed.usage) {
          const result = transformLiveUsageData(parsed.usage);
          llmUsageCache.data = result;
          llmUsageCache.timestamp = Date.now();
          console.log("[LLM Usage] Cache refreshed");
        }
      } catch (e) {
        console.error("[LLM Usage] Parse error:", e.message);
      }
    },
  );
}
function transformLiveUsageData(usage) {
  const anthropic = usage.providers?.find((p) => p.provider === "anthropic");
  const codexProvider = usage.providers?.find((p) => p.provider === "openai-codex");
  if (anthropic?.error) {
    return {
      timestamp: /* @__PURE__ */ new Date().toISOString(),
      source: "error",
      error: anthropic.error,
      errorType: anthropic.error.includes("403") ? "auth" : "unknown",
      claude: {
        session: { usedPct: null, remainingPct: null, resetsIn: null, error: anthropic.error },
        weekly: { usedPct: null, remainingPct: null, resets: null, error: anthropic.error },
        sonnet: { usedPct: null, remainingPct: null, resets: null, error: anthropic.error },
        lastSynced: null,
      },
      codex: { sessionsToday: 0, tasksToday: 0, usage5hPct: 0, usageDayPct: 0 },
      routing: {
        total: 0,
        claudeTasks: 0,
        codexTasks: 0,
        claudePct: 0,
        codexPct: 0,
        codexFloor: 20,
      },
    };
  }
  const session5h = anthropic?.windows?.find((w) => w.label === "5h");
  const weekAll = anthropic?.windows?.find((w) => w.label === "Week");
  const sonnetWeek = anthropic?.windows?.find((w) => w.label === "Sonnet");
  const codex5h = codexProvider?.windows?.find((w) => w.label === "5h");
  const codexDay = codexProvider?.windows?.find((w) => w.label === "Day");
  const formatReset = (resetAt) => {
    if (!resetAt) return "?";
    const diff = resetAt - Date.now();
    if (diff < 0) return "now";
    if (diff < 36e5) return Math.round(diff / 6e4) + "m";
    if (diff < 864e5) return Math.round(diff / 36e5) + "h";
    return Math.round(diff / 864e5) + "d";
  };
  return {
    timestamp: /* @__PURE__ */ new Date().toISOString(),
    source: "live",
    claude: {
      session: {
        usedPct: Math.round(session5h?.usedPercent || 0),
        remainingPct: Math.round(100 - (session5h?.usedPercent || 0)),
        resetsIn: formatReset(session5h?.resetAt),
      },
      weekly: {
        usedPct: Math.round(weekAll?.usedPercent || 0),
        remainingPct: Math.round(100 - (weekAll?.usedPercent || 0)),
        resets: formatReset(weekAll?.resetAt),
      },
      sonnet: {
        usedPct: Math.round(sonnetWeek?.usedPercent || 0),
        remainingPct: Math.round(100 - (sonnetWeek?.usedPercent || 0)),
        resets: formatReset(sonnetWeek?.resetAt),
      },
      lastSynced: /* @__PURE__ */ new Date().toISOString(),
    },
    codex: {
      sessionsToday: 0,
      tasksToday: 0,
      usage5hPct: Math.round(codex5h?.usedPercent || 0),
      usageDayPct: Math.round(codexDay?.usedPercent || 0),
    },
    routing: { total: 0, claudeTasks: 0, codexTasks: 0, claudePct: 0, codexPct: 0, codexFloor: 20 },
  };
}
setTimeout(() => refreshLlmUsageAsync(), 1e3);
setInterval(() => refreshLlmUsageAsync(), LLM_CACHE_TTL_MS);
function getLlmUsage() {
  const now = Date.now();
  if (!llmUsageCache.data || now - llmUsageCache.timestamp > LLM_CACHE_TTL_MS) {
    refreshLlmUsageAsync();
  }
  if (llmUsageCache.data && llmUsageCache.data.source !== "error") {
    return llmUsageCache.data;
  }
  const stateFile = path.join(PATHS.state, "llm-routing.json");
  try {
    if (fs.existsSync(stateFile)) {
      const data = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      const sessionValid =
        data.claude?.session?.resets_in && data.claude.session.resets_in !== "unknown";
      const weeklyValid =
        data.claude?.weekly_all_models?.resets &&
        data.claude.weekly_all_models.resets !== "unknown";
      if (sessionValid || weeklyValid) {
        return {
          timestamp: /* @__PURE__ */ new Date().toISOString(),
          source: "file",
          claude: {
            session: {
              usedPct: Math.round((data.claude?.session?.used_pct || 0) * 100),
              remainingPct: Math.round((data.claude?.session?.remaining_pct || 1) * 100),
              resetsIn: data.claude?.session?.resets_in || "?",
            },
            weekly: {
              usedPct: Math.round((data.claude?.weekly_all_models?.used_pct || 0) * 100),
              remainingPct: Math.round((data.claude?.weekly_all_models?.remaining_pct || 1) * 100),
              resets: data.claude?.weekly_all_models?.resets || "?",
            },
            sonnet: {
              usedPct: Math.round((data.claude?.weekly_sonnet?.used_pct || 0) * 100),
              remainingPct: Math.round((data.claude?.weekly_sonnet?.remaining_pct || 1) * 100),
              resets: data.claude?.weekly_sonnet?.resets || "?",
            },
            lastSynced: data.claude?.last_synced || null,
          },
          codex: {
            sessionsToday: data.codex?.sessions_today || 0,
            tasksToday: data.codex?.tasks_today || 0,
            usage5hPct: data.codex?.usage_5h_pct || 0,
            usageDayPct: data.codex?.usage_day_pct || 0,
          },
          routing: {
            total: data.routing?.total_tasks || 0,
            claudeTasks: data.routing?.claude_tasks || 0,
            codexTasks: data.routing?.codex_tasks || 0,
            claudePct:
              data.routing?.total_tasks > 0
                ? Math.round((data.routing.claude_tasks / data.routing.total_tasks) * 100)
                : 0,
            codexPct:
              data.routing?.total_tasks > 0
                ? Math.round((data.routing.codex_tasks / data.routing.total_tasks) * 100)
                : 0,
            codexFloor: Math.round((data.routing?.codex_floor_pct || 0.2) * 100),
          },
        };
      }
    }
  } catch (e) {
    console.error("[LLM Usage] File fallback failed:", e.message);
  }
  return {
    timestamp: /* @__PURE__ */ new Date().toISOString(),
    source: "error",
    error: "API key lacks user:profile OAuth scope",
    errorType: "auth",
    claude: {
      session: { usedPct: null, remainingPct: null, resetsIn: null, error: "Auth required" },
      weekly: { usedPct: null, remainingPct: null, resets: null, error: "Auth required" },
      sonnet: { usedPct: null, remainingPct: null, resets: null, error: "Auth required" },
      lastSynced: null,
    },
    codex: { sessionsToday: 0, tasksToday: 0, usage5hPct: 0, usageDayPct: 0 },
    routing: { total: 0, claudeTasks: 0, codexTasks: 0, claudePct: 0, codexPct: 0, codexFloor: 20 },
  };
}
function getRoutingStats(hours = 24) {
  try {
    const skillDir = path.join(PATHS.skills, "llm_routing");
    const output = execSync(
      `cd "${skillDir}" && python -m llm_routing stats --hours ${hours} --json 2>/dev/null`,
      {
        encoding: "utf8",
        timeout: 1e4,
      },
    );
    return JSON.parse(output);
  } catch (e) {
    try {
      const logFile = path.join(PATHS.state, "routing-log.jsonl");
      if (!fs.existsSync(logFile)) {
        return { total_requests: 0, by_model: {}, by_task_type: {} };
      }
      const cutoff = Date.now() - hours * 3600 * 1e3;
      const lines = fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean);
      const stats = {
        total_requests: 0,
        by_model: {},
        by_task_type: {},
        escalations: 0,
        avg_latency_ms: 0,
        success_rate: 0,
      };
      let latencies = [];
      let successes = 0;
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const ts = new Date(entry.timestamp).getTime();
          if (ts < cutoff) continue;
          stats.total_requests++;
          const model = entry.selected_model || "unknown";
          stats.by_model[model] = (stats.by_model[model] || 0) + 1;
          const tt = entry.task_type || "unknown";
          stats.by_task_type[tt] = (stats.by_task_type[tt] || 0) + 1;
          if (entry.escalation_reason) stats.escalations++;
          if (entry.latency_ms) latencies.push(entry.latency_ms);
          if (entry.success === true) successes++;
        } catch {}
      }
      if (latencies.length > 0) {
        stats.avg_latency_ms = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
      }
      if (stats.total_requests > 0) {
        stats.success_rate = Math.round((successes / stats.total_requests) * 100);
      }
      return stats;
    } catch (e2) {
      console.error("Failed to read routing stats:", e2.message);
      return { error: e2.message };
    }
  }
}
function getSubagentStatus() {
  const subagents = [];
  try {
    const output = runOpenClaw("sessions list --json 2>/dev/null");
    const jsonStr = extractJSON(output);
    if (jsonStr) {
      const data = JSON.parse(jsonStr);
      const subagentSessions = (data.sessions || []).filter(
        (s) => s.key && s.key.includes(":subagent:"),
      );
      for (const s of subagentSessions) {
        const ageMs = s.ageMs || Infinity;
        const isActive = ageMs < 5 * 60 * 1e3;
        const isRecent = ageMs < 30 * 60 * 1e3;
        const match = s.key.match(/:subagent:([a-f0-9-]+)$/);
        const subagentId = match ? match[1] : s.sessionId;
        const shortId = subagentId.slice(0, 8);
        let taskSummary = "Unknown task";
        let label = null;
        const transcript = readTranscript(s.sessionId);
        for (const entry of transcript.slice(0, 15)) {
          if (entry.type === "message" && entry.message?.role === "user") {
            const content = entry.message.content;
            let text = "";
            if (typeof content === "string") {
              text = content;
            } else if (Array.isArray(content)) {
              const textPart = content.find((c) => c.type === "text");
              if (textPart) text = textPart.text || "";
            }
            if (!text) continue;
            const labelMatch = text.match(/Label:\s*([^\n]+)/i);
            if (labelMatch) {
              label = labelMatch[1].trim();
            }
            let taskMatch = text.match(/You were created to handle:\s*\*\*([^*]+)\*\*/i);
            if (taskMatch) {
              taskSummary = taskMatch[1].trim();
              break;
            }
            taskMatch = text.match(/\*\*([A-Z]{2,5}-\d+:\s*[^*]+)\*\*/);
            if (taskMatch) {
              taskSummary = taskMatch[1].trim();
              break;
            }
            const firstLine = text
              .split("\n")[0]
              .replace(/^\*\*|\*\*$/g, "")
              .trim();
            if (firstLine.length > 10 && firstLine.length < 100) {
              taskSummary = firstLine;
              break;
            }
          }
        }
        const messageCount = transcript.filter(
          (e) => e.type === "message" && e.message?.role,
        ).length;
        subagents.push({
          id: subagentId,
          shortId,
          sessionId: s.sessionId,
          label: label || shortId,
          task: taskSummary,
          model: s.model?.replace("anthropic/", "") || "unknown",
          status: isActive ? "active" : isRecent ? "idle" : "stale",
          ageMs,
          ageFormatted:
            ageMs < 6e4
              ? "Just now"
              : ageMs < 36e5
                ? `${Math.round(ageMs / 6e4)}m ago`
                : `${Math.round(ageMs / 36e5)}h ago`,
          messageCount,
          tokens: s.totalTokens || 0,
        });
      }
    }
  } catch (e) {
    console.error("Failed to get subagent status:", e.message);
  }
  return subagents.sort((a, b) => a.ageMs - b.ageMs);
}
function executeAction(action) {
  const results = { success: false, action, output: "", error: null };
  try {
    switch (action) {
      case "gateway-status":
        results.output = runOpenClaw("gateway status 2>&1") || "Unknown";
        results.success = true;
        break;
      case "gateway-restart":
        results.output = "To restart gateway, run: openclaw gateway restart";
        results.success = true;
        results.note = "Dashboard cannot restart gateway for safety";
        break;
      case "sessions-list":
        results.output = runOpenClaw("sessions list 2>&1") || "No sessions";
        results.success = true;
        break;
      case "cron-list":
        results.output = runOpenClaw("cron list 2>&1") || "No cron jobs";
        results.success = true;
        break;
      case "health-check":
        const gateway = runOpenClaw("gateway status 2>&1");
        const sessions = runOpenClaw("sessions list --json 2>&1");
        let sessionCount = 0;
        try {
          const data = JSON.parse(sessions);
          sessionCount = data.sessions?.length || 0;
        } catch (e) {}
        results.output = [
          `Gateway: ${gateway?.includes("running") ? "\u2705 Running" : "\u274C Not running"}`,
          `Sessions: ${sessionCount}`,
          `Dashboard: \u2705 Running on port ${PORT}`,
        ].join("\n");
        results.success = true;
        break;
      case "clear-stale-sessions":
        const staleOutput = runOpenClaw("sessions list --json 2>&1");
        let staleCount = 0;
        try {
          const staleJson = extractJSON(staleOutput);
          if (staleJson) {
            const data = JSON.parse(staleJson);
            staleCount = (data.sessions || []).filter((s) => s.ageMs > 24 * 60 * 60 * 1e3).length;
          }
        } catch (e) {}
        results.output = `Found ${staleCount} stale sessions (>24h old).
To clean: openclaw sessions prune`;
        results.success = true;
        break;
      default:
        results.error = `Unknown action: ${action}`;
    }
  } catch (e) {
    results.error = e.message;
  }
  return results;
}
var server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const urlParts = req.url.split("?");
  const pathname = urlParts[0];
  const query = new URLSearchParams(urlParts[1] || "");
  if (pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        port: PORT,
        timestamp: /* @__PURE__ */ new Date().toISOString(),
      }),
    );
    return;
  }
  const isPublicPath = AUTH_CONFIG.publicPaths.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  if (!isPublicPath && AUTH_CONFIG.mode !== "none") {
    const authResult = checkAuth(req);
    if (!authResult.authorized) {
      console.log(`[AUTH] Denied: ${authResult.reason} (path: ${pathname})`);
      res.writeHead(403, { "Content-Type": "text/html" });
      res.end(getUnauthorizedPage(authResult.reason, authResult.user));
      return;
    }
    req.authUser = authResult.user;
    if (authResult.user?.login || authResult.user?.email) {
      console.log(
        `[AUTH] Allowed: ${authResult.user.login || authResult.user.email} (path: ${pathname})`,
      );
    } else {
      console.log(`[AUTH] Allowed: ${req.socket?.remoteAddress} (path: ${pathname})`);
    }
  }
  if (pathname === "/api/status") {
    handleApi(req, res);
  } else if (pathname === "/api/session") {
    const sessionKey = query.get("key");
    if (!sessionKey) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing session key" }));
      return;
    }
    const detail = getSessionDetail(sessionKey);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(detail, null, 2));
  } else if (pathname === "/api/cerebro") {
    const offset = parseInt(query.get("offset") || "0", 10);
    const limit = parseInt(query.get("limit") || "20", 10);
    const status = query.get("status") || "all";
    const data = getCerebroTopics({ offset, limit, status });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data, null, 2));
  } else if (
    pathname.startsWith("/api/cerebro/topic/") &&
    pathname.endsWith("/status") &&
    req.method === "POST"
  ) {
    const topicId = decodeURIComponent(
      pathname.replace("/api/cerebro/topic/", "").replace("/status", ""),
    );
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const { status: newStatus } = JSON.parse(body);
        if (!newStatus || !["active", "resolved", "parked"].includes(newStatus)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "Invalid status. Must be: active, resolved, or parked" }),
          );
          return;
        }
        const result = updateTopicStatus(topicId, newStatus);
        if (result.error) {
          res.writeHead(result.code || 500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: result.error }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result, null, 2));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
      }
    });
    return;
  } else if (pathname === "/api/llm-quota") {
    const data = getLlmUsage();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data, null, 2));
  } else if (pathname === "/api/cost-breakdown") {
    const data = getCostBreakdown();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data, null, 2));
  } else if (pathname === "/api/subagents") {
    const data = getSubagentStatus();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ subagents: data }, null, 2));
  } else if (pathname === "/api/action") {
    const action = query.get("action");
    if (!action) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing action parameter" }));
      return;
    }
    const result = executeAction(action);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result, null, 2));
  } else if (pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    sseClients.add(res);
    console.log(`[SSE] Client connected (total: ${sseClients.size})`);
    sendSSE(res, "connected", { message: "Connected to Command Center", timestamp: Date.now() });
    if (cachedState) {
      sendSSE(res, "update", cachedState);
    } else {
      sendSSE(res, "update", { sessions: [], loading: true });
    }
    req.on("close", () => {
      sseClients.delete(res);
      console.log(`[SSE] Client disconnected (total: ${sseClients.size})`);
    });
    return;
  } else if (pathname === "/api/whoami") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        {
          authMode: AUTH_CONFIG.mode,
          user: req.authUser || null,
        },
        null,
        2,
      ),
    );
  } else if (pathname === "/api/about") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        {
          name: "OpenClaw Command Center",
          version: "0.1.0",
          description: "A Starcraft-inspired dashboard for AI agent orchestration",
          license: "MIT",
          repository: "https://github.com/jontsai/openclaw-command-center",
          builtWith: ["OpenClaw", "Node.js", "Vanilla JS"],
          inspirations: ["Starcraft", "Inside Out", "iStatMenus", "DaisyDisk", "Gmail"],
        },
        null,
        2,
      ),
    );
  } else if (pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        port: PORT,
        timestamp: /* @__PURE__ */ new Date().toISOString(),
      }),
    );
  } else if (pathname === "/api/state") {
    const state = getFullState();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(state, null, 2));
  } else if (pathname === "/api/vitals") {
    const vitals = getSystemVitals();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ vitals }, null, 2));
  } else if (pathname === "/api/capacity") {
    const capacity = getCapacity();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(capacity, null, 2));
  } else if (pathname === "/api/sessions") {
    const page = parseInt(query.get("page")) || 1;
    const pageSize = parseInt(query.get("pageSize")) || 20;
    const statusFilter = query.get("status");
    const allSessions = getSessions({ limit: null });
    const statusCounts = {
      all: allSessions.length,
      live: allSessions.filter((s) => s.active).length,
      recent: allSessions.filter((s) => !s.active && s.recentlyActive).length,
      idle: allSessions.filter((s) => !s.active && !s.recentlyActive).length,
    };
    let filteredSessions = allSessions;
    if (statusFilter === "live") {
      filteredSessions = allSessions.filter((s) => s.active);
    } else if (statusFilter === "recent") {
      filteredSessions = allSessions.filter((s) => !s.active && s.recentlyActive);
    } else if (statusFilter === "idle") {
      filteredSessions = allSessions.filter((s) => !s.active && !s.recentlyActive);
    }
    const total = filteredSessions.length;
    const totalPages = Math.ceil(total / pageSize);
    const offset = (page - 1) * pageSize;
    const displaySessions = filteredSessions.slice(offset, offset + pageSize);
    const tokenStats = getTokenStats(allSessions);
    const capacity = getCapacity();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        {
          sessions: displaySessions,
          pagination: {
            page,
            pageSize,
            total,
            totalPages,
            hasPrev: page > 1,
            hasNext: page < totalPages,
          },
          statusCounts,
          tokenStats,
          capacity,
        },
        null,
        2,
      ),
    );
  } else if (pathname === "/api/cron") {
    const cron = getCronJobs();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ cron }, null, 2));
  } else if (pathname === "/api/operators") {
    const method = req.method;
    const data = loadOperators();
    if (method === "GET") {
      const sessions = getSessions({ limit: null });
      const operatorsWithStats = data.operators.map((op) => {
        const userSessions = sessions.filter(
          (s) => s.originator?.userId === op.id || s.originator?.userId === op.metadata?.slackId,
        );
        return {
          ...op,
          stats: {
            activeSessions: userSessions.filter((s) => s.active).length,
            totalSessions: userSessions.length,
            lastSeen:
              userSessions.length > 0
                ? new Date(
                    Date.now() - Math.min(...userSessions.map((s) => s.minutesAgo)) * 6e4,
                  ).toISOString()
                : op.lastSeen,
          },
        };
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          {
            operators: operatorsWithStats,
            roles: data.roles,
            timestamp: Date.now(),
          },
          null,
          2,
        ),
      );
    } else if (method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const newOp = JSON.parse(body);
          const existingIdx = data.operators.findIndex((op) => op.id === newOp.id);
          if (existingIdx >= 0) {
            data.operators[existingIdx] = { ...data.operators[existingIdx], ...newOp };
          } else {
            data.operators.push({
              ...newOp,
              createdAt: /* @__PURE__ */ new Date().toISOString(),
            });
          }
          if (saveOperators(data)) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, operator: newOp }));
          } else {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Failed to save" }));
          }
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
      return;
    } else {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
    }
    return;
  } else if (pathname === "/api/llm-usage") {
    const usage = getLlmUsage();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(usage, null, 2));
  } else if (pathname === "/api/routing-stats") {
    const hours = parseInt(query.get("hours") || "24", 10);
    const stats = getRoutingStats(hours);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(stats, null, 2));
  } else if (pathname === "/api/memory") {
    const memory = getMemoryStats();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ memory }, null, 2));
  } else if (pathname === "/api/privacy") {
    if (req.method === "GET") {
      const settings = loadPrivacySettings();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(settings, null, 2));
    } else if (req.method === "POST" || req.method === "PUT") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const updates = JSON.parse(body);
          const current = loadPrivacySettings();
          const merged = {
            version: current.version || 1,
            hiddenTopics: updates.hiddenTopics ?? current.hiddenTopics ?? [],
            hiddenSessions: updates.hiddenSessions ?? current.hiddenSessions ?? [],
            hiddenCrons: updates.hiddenCrons ?? current.hiddenCrons ?? [],
            hideHostname: updates.hideHostname ?? current.hideHostname ?? false,
          };
          if (savePrivacySettings(merged)) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, settings: merged }));
          } else {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Failed to save privacy settings" }));
          }
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON: " + e.message }));
        }
      });
      return;
    } else {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
    }
    return;
  } else if (isJobsRoute(pathname)) {
    handleJobsRequest(req, res, pathname, query, req.method);
  } else {
    serveStatic(req, res);
  }
});
server.listen(PORT, () => {
  const profile = process.env.OPENCLAW_PROFILE;
  console.log(`\u{1F99E} OpenClaw Command Center running at http://localhost:${PORT}`);
  if (profile) {
    console.log(`   Profile: ${profile} (~/.openclaw-${profile})`);
  }
  console.log(`   Press Ctrl+C to stop`);
  setTimeout(async () => {
    console.log("[Startup] Pre-warming caches in background...");
    try {
      await Promise.all([refreshSessionsCache(), refreshTokenUsageAsync()]);
      getSystemVitals();
      console.log("[Startup] Caches warmed.");
    } catch (e) {
      console.log("[Startup] Cache warming error:", e.message);
    }
  }, 100);
  setInterval(() => refreshSessionsCache(), SESSIONS_CACHE_TTL);
  setInterval(() => refreshTokenUsageAsync(), TOKEN_USAGE_CACHE_TTL);
});
var sseRefreshing = false;
setInterval(() => {
  if (sseClients.size > 0 && !sseRefreshing) {
    sseRefreshing = true;
    try {
      const state = refreshState();
      broadcastSSE("update", state);
      broadcastSSE("heartbeat", { clients: sseClients.size, timestamp: Date.now() });
    } catch (e) {
      console.error("[SSE] Broadcast error:", e.message);
    }
    sseRefreshing = false;
  }
}, 15e3);
