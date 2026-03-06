/**
 * System vitals collection for OpenClaw Command Center
 * Collects CPU, memory, disk, and temperature metrics
 */

const { runCmd, formatBytes } = require("./utils");

// Vitals cache to reduce blocking
let cachedVitals = null;
let lastVitalsUpdate = 0;
const VITALS_CACHE_TTL = 30000; // 30 seconds - vitals don't change fast
let vitalsRefreshing = false;

// Async background refresh of system vitals (non-blocking)
async function refreshVitalsAsync() {
  if (vitalsRefreshing) return;
  vitalsRefreshing = true;

  const vitals = {
    hostname: "",
    uptime: "",
    disk: { used: 0, free: 0, total: 0, percent: 0, kbPerTransfer: 0, iops: 0, throughputMBps: 0 },
    cpu: { loadAvg: [0, 0, 0], cores: 0, usage: 0 },
    memory: { used: 0, free: 0, total: 0, percent: 0, pressure: "normal" },
    temperature: null,
  };

  // Detect platform for cross-platform support
  const isLinux = process.platform === "linux";
  const isMacOS = process.platform === "darwin";

  try {
    // Platform-specific commands
    const coresCmd = isLinux ? "nproc" : "sysctl -n hw.ncpu";
    const memCmd = isLinux
      ? "cat /proc/meminfo | grep MemTotal | awk '{print $2}'"
      : "sysctl -n hw.memsize";
    const topCmd = isLinux
      ? "top -bn1 | head -3 | grep -E '^%?Cpu|^  ?CPU' || echo ''"
      : 'top -l 1 -n 0 2>/dev/null | grep "CPU usage" || echo ""';

    // Linux: prefer mpstat (1s average) to avoid spiky single-frame top parsing.
    const mpstatCmd = isLinux
      ? "(command -v mpstat >/dev/null 2>&1 && mpstat 1 1 | tail -1 | sed 's/^Average: *//') || echo ''"
      : "";

    // Run commands in parallel for speed
    const [hostname, uptimeRaw, coresRaw, memTotalRaw, memInfoRaw, dfRaw, topOutput, mpstatOutput] =
      await Promise.all([
        runCmd("hostname", { fallback: "unknown" }),
        runCmd("uptime", { fallback: "" }),
        runCmd(coresCmd, { fallback: "1" }),
        runCmd(memCmd, { fallback: "0" }),
        isLinux
          ? runCmd("cat /proc/meminfo", { fallback: "" })
          : runCmd("vm_stat", { fallback: "" }),
        runCmd("df -k ~ | tail -1", { fallback: "" }),
        runCmd(topCmd, { fallback: "" }),
        isLinux ? runCmd(mpstatCmd, { fallback: "" }) : Promise.resolve(""),
      ]);

    vitals.hostname = hostname;

    // Parse uptime
    const uptimeMatch = uptimeRaw.match(/up\s+([^,]+)/);
    if (uptimeMatch) vitals.uptime = uptimeMatch[1].trim();
    const loadMatch = uptimeRaw.match(/load averages?:\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
    if (loadMatch)
      vitals.cpu.loadAvg = [
        parseFloat(loadMatch[1]),
        parseFloat(loadMatch[2]),
        parseFloat(loadMatch[3]),
      ];

    // CPU
    vitals.cpu.cores = parseInt(coresRaw, 10) || 1;
    vitals.cpu.usage = Math.min(100, Math.round((vitals.cpu.loadAvg[0] / vitals.cpu.cores) * 100));

    // CPU percent (platform-specific)
    // Linux: prefer mpstat output (averaged over 1 second). Fallback to parsing top.
    if (isLinux) {
      // mpstat: ... %usr %nice %sys %iowait %irq %soft %steal %guest %gnice %idle
      if (mpstatOutput) {
        // After sed, mpstatOutput should look like:
        // "all  7.69 0.00 2.05 ... 89.74" (CPU %usr %nice %sys ... %idle)
        const parts = mpstatOutput.trim().split(/\s+/);
        const user = parts.length > 1 ? parseFloat(parts[1]) : NaN;
        const sys = parts.length > 3 ? parseFloat(parts[3]) : NaN;
        const idle = parts.length ? parseFloat(parts[parts.length - 1]) : NaN;
        if (!Number.isNaN(user)) vitals.cpu.userPercent = user;
        if (!Number.isNaN(sys)) vitals.cpu.sysPercent = sys;
        if (!Number.isNaN(idle)) {
          vitals.cpu.idlePercent = idle;
          vitals.cpu.usage = Math.max(0, Math.min(100, Math.round(100 - idle)));
        }
      }

      if (topOutput && (vitals.cpu.idlePercent === null || vitals.cpu.idlePercent === undefined)) {
        // Linux top: %Cpu(s):  5.9 us,  2.0 sy,  0.0 ni, 91.5 id,  0.5 wa, ...
        const userMatch = topOutput.match(/([\d.]+)\s*us/);
        const sysMatch = topOutput.match(/([\d.]+)\s*sy/);
        const idleMatch = topOutput.match(/([\d.]+)\s*id/);
        vitals.cpu.userPercent = userMatch ? parseFloat(userMatch[1]) : null;
        vitals.cpu.sysPercent = sysMatch ? parseFloat(sysMatch[1]) : null;
        vitals.cpu.idlePercent = idleMatch ? parseFloat(idleMatch[1]) : null;
        if (vitals.cpu.userPercent !== null && vitals.cpu.sysPercent !== null) {
          vitals.cpu.usage = Math.round(vitals.cpu.userPercent + vitals.cpu.sysPercent);
        }
      }
    } else if (topOutput) {
      // macOS: CPU usage: 5.9% user, 2.0% sys, 91.5% idle
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

    // Disk
    const dfParts = dfRaw.split(/\s+/);
    if (dfParts.length >= 4) {
      vitals.disk.total = parseInt(dfParts[1], 10) * 1024;
      vitals.disk.used = parseInt(dfParts[2], 10) * 1024;
      vitals.disk.free = parseInt(dfParts[3], 10) * 1024;
      vitals.disk.percent = Math.round((parseInt(dfParts[2], 10) / parseInt(dfParts[1], 10)) * 100);
    }

    // Memory (platform-specific)
    if (isLinux) {
      const memTotalKB = parseInt(memTotalRaw, 10) || 0;
      const memAvailableMatch = memInfoRaw.match(/MemAvailable:\s+(\d+)/);
      const memFreeMatch = memInfoRaw.match(/MemFree:\s+(\d+)/);

      vitals.memory.total = memTotalKB * 1024;
      const memAvailable = parseInt(memAvailableMatch?.[1] || memFreeMatch?.[1] || 0, 10) * 1024;

      vitals.memory.used = vitals.memory.total - memAvailable;
      vitals.memory.free = memAvailable;
      vitals.memory.percent =
        vitals.memory.total > 0 ? Math.round((vitals.memory.used / vitals.memory.total) * 100) : 0;
    } else {
      const pageSizeMatch = memInfoRaw.match(/page size of (\d+) bytes/);
      const pageSize = pageSizeMatch ? parseInt(pageSizeMatch[1], 10) : 4096;
      const activePages = parseInt((memInfoRaw.match(/Pages active:\s+(\d+)/) || [])[1] || 0, 10);
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
        vitals.memory.total > 0 ? Math.round((vitals.memory.used / vitals.memory.total) * 100) : 0;
    }
    vitals.memory.pressure =
      vitals.memory.percent > 90 ? "critical" : vitals.memory.percent > 75 ? "warning" : "normal";

    // Secondary async calls (chip info, iostat)
    // NOTE: iostat needs an explicit count, otherwise it runs forever.
    // We sample 2 iterations and take the last line (or JSON on Linux).
    const iostatCmd = isLinux
      ? "timeout 5 iostat -d -o JSON 1 2 2>/dev/null || echo ''"
      : "iostat -d -c 2 2 2>/dev/null | tail -1 || echo ''";
    const [perfCores, effCores, chip, iostatRaw] = await Promise.all([
      isMacOS
        ? runCmd("sysctl -n hw.perflevel0.logicalcpu 2>/dev/null || echo 0", { fallback: "0" })
        : Promise.resolve("0"),
      isMacOS
        ? runCmd("sysctl -n hw.perflevel1.logicalcpu 2>/dev/null || echo 0", { fallback: "0" })
        : Promise.resolve("0"),
      isMacOS
        ? runCmd(
            'system_profiler SPHardwareDataType 2>/dev/null | grep "Chip:" | cut -d: -f2 || echo ""',
            { fallback: "" },
          )
        : Promise.resolve(""),
      runCmd(iostatCmd, { fallback: "", timeout: 5000 }),
    ]);

    if (isLinux) {
      const cpuBrand = await runCmd(
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
          vitals.disk.kbPerTransfer = disk.tps > 0 ? (kbReadPerSec + kbWrtnPerSec) / disk.tps : 0;
        }
      } catch {
        // JSON parse failed
      }
    } else {
      const iostatParts = iostatRaw.split(/\s+/);
      if (iostatParts.length >= 3) {
        vitals.disk.kbPerTransfer = parseFloat(iostatParts[0]) || 0;
        vitals.disk.iops = parseFloat(iostatParts[1]) || 0;
        vitals.disk.throughputMBps = parseFloat(iostatParts[2]) || 0;
      }
    }
    // Temperature
    vitals.temperature = null;
    vitals.temperatureNote = null;
    const isAppleSilicon = vitals.cpu.chip && /apple/i.test(vitals.cpu.chip);

    if (isAppleSilicon) {
      vitals.temperatureNote = "Apple Silicon (requires elevated access)";
      try {
        const pmOutput = await runCmd(
          'sudo -n powermetrics --samplers smc -i 1 -n 1 2>/dev/null | grep -i "die temp" | head -1',
          { fallback: "", timeout: 5000 },
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
        const temp = await runCmd(
          `osx-cpu-temp 2>/dev/null || ${home}/bin/osx-cpu-temp 2>/dev/null`,
          { fallback: "" },
        );
        if (temp && temp.includes("\u00b0")) {
          const tempMatch = temp.match(/([\d.]+)/);
          if (tempMatch && parseFloat(tempMatch[1]) > 0) {
            vitals.temperature = parseFloat(tempMatch[1]);
          }
        }
      } catch (e) {}
      if (!vitals.temperature) {
        try {
          const ioregRaw = await runCmd(
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
        const temp = await runCmd("cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null", {
          fallback: "",
        });
        if (temp) {
          vitals.temperature = Math.round(parseInt(temp, 10) / 1000);
        }
      } catch (e) {}
    }
  } catch (e) {
    console.error("[Vitals] Async refresh failed:", e.message);
  }

  // Formatted versions
  vitals.memory.usedFormatted = formatBytes(vitals.memory.used);
  vitals.memory.totalFormatted = formatBytes(vitals.memory.total);
  vitals.memory.freeFormatted = formatBytes(vitals.memory.free);
  vitals.disk.usedFormatted = formatBytes(vitals.disk.used);
  vitals.disk.totalFormatted = formatBytes(vitals.disk.total);
  vitals.disk.freeFormatted = formatBytes(vitals.disk.free);

  cachedVitals = vitals;
  lastVitalsUpdate = Date.now();
  vitalsRefreshing = false;
  console.log("[Vitals] Cache refreshed async");
}

// Start background vitals refresh on startup
setTimeout(() => refreshVitalsAsync(), 500);
setInterval(() => refreshVitalsAsync(), VITALS_CACHE_TTL);

function getSystemVitals() {
  const now = Date.now();
  if (!cachedVitals || now - lastVitalsUpdate > VITALS_CACHE_TTL) {
    refreshVitalsAsync();
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

module.exports = {
  refreshVitalsAsync,
  getSystemVitals,
  VITALS_CACHE_TTL,
};
