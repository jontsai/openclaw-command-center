const { stripVTControlCharacters } = require("node:util");

// Per runtime/profile host. Accounts and providers never share a directory cache.
function createChannelDirectory({ run, now = Date.now, refreshMs = 300000 }) {
  const scopes = new Map();
  function lookup(provider, id, account = "") {
    if (!["slack", "discord"].includes(provider) || !id || !/^[a-zA-Z0-9_-]*$/.test(account))
      return { name: null, status: "unavailable" };
    const key = JSON.stringify([provider, account]);
    if (!scopes.has(key)) {
      if (scopes.size >= 8) return { name: null, status: "unavailable" };
      scopes.set(key, {
        names: new Map(),
        nextCheck: 0,
        pending: null,
        status: "loading",
        observedAt: null,
      });
    }
    const scope = scopes.get(key);
    if (!scope.pending && now() >= scope.nextCheck) {
      scope.nextCheck = now() + refreshMs;
      scope.pending = Promise.resolve().then(async () => {
        try {
          const args = [
            "directory",
            "groups",
            "list",
            "--channel",
            provider,
            "--limit",
            "1000",
            "--json",
          ];
          if (account) args.push("--account", account);
          const raw = await run(args, { timeout: 10000 });
          if (typeof raw !== "string" || Buffer.byteLength(raw) > 4 * 1024 * 1024)
            throw Error("invalid_directory");
          const rows = JSON.parse(stripVTControlCharacters(raw));
          if (!Array.isArray(rows) || rows.length > 1000) throw Error("invalid_directory");
          const names = new Map();
          for (const row of rows) {
            if (typeof row?.id !== "string" || typeof row.name !== "string") continue;
            const name = row.name.trim().slice(0, 120);
            const channelId = row.id.replace(/^channel:/, "").toLowerCase();
            if (!name || !/^[a-z0-9_-]+$/i.test(channelId)) continue;
            if (names.has(channelId) && names.get(channelId) !== name)
              throw Error("ambiguous_directory");
            names.set(channelId, name);
          }
          scope.names = names;
          scope.status = rows.length === 1000 ? "partial" : "available";
          scope.observedAt = now();
        } catch {
          scope.status = scope.observedAt === null ? "unavailable" : "stale";
        } finally {
          scope.pending = null;
          scope.nextCheck = now() + refreshMs;
        }
      });
    }
    return {
      name: scope.names.get(id.toLowerCase()) || null,
      status: scope.status,
      observedAt: scope.observedAt,
    };
  }
  return { lookup, settled: () => Promise.all([...scopes.values()].map((s) => s.pending)) };
}
module.exports = { createChannelDirectory };
