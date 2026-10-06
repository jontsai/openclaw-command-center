/* Explicit session facets only. No inferred topics, parentage, or task status. */
(function (root) {
  const text = (value) => (typeof value === "string" ? value : "");
  const finite = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
  function normalize(session, index = 0) {
    const key = text(session.sessionKey);
    const parts = key.split(":");
    const agent = text(session.agentId) || (parts[0] === "agent" ? parts[1] : "") || "";
    const age = finite(session.minutesAgo) ? session.minutesAgo : null;
    const status =
      session.active === true
        ? "live"
        : session.recentlyActive === true
          ? "recent"
          : age === null
            ? "unknown"
            : "idle";
    const activity =
      age === null
        ? "unknown"
        : age < 60
          ? "hour"
          : age < 1440
            ? "day"
            : age < 10080
              ? "week"
              : "older";
    const platform = text(session.channel) || "unknown";
    const channelId = text(session.channelId);
    const account = text(session.channelAccount);
    const kind = text(session.sessionType) || text(session.kind) || "unknown";
    const channelName = text(session.channelName);
    // Missing channel identities stay distinct; equal labels do not establish identity.
    const channelKey = channelId
      ? JSON.stringify([platform, account, channelId.toLowerCase()])
      : JSON.stringify(["unresolved", key || index]);
    const rawLabel = text(session.label);
    const label = rawLabel && !rawLabel.startsWith("agent:") ? rawLabel : channelName;
    return {
      key,
      id: key || `unknown-${index}`,
      agent,
      age,
      status,
      activity,
      platform,
      channelId,
      account,
      channelName,
      channelKey,
      kind,
      label,
      model: text(session.model),
      operator: text(session.originator?.displayName) || text(session.originator?.username),
      tokens: finite(session.tokens) ? session.tokens : null,
      resolution: text(session.channelNameStatus) || "unknown",
    };
  }
  function visible(sessions, privacy) {
    if (!privacy || !Array.isArray(privacy.hiddenSessions))
      throw new Error("Privacy settings unavailable");
    const hidden = new Set(privacy.hiddenSessions.map((x) => text(x.id).trim().toLowerCase()));
    return sessions
      .filter((x) => !hidden.has(text(x.sessionKey).trim().toLowerCase()))
      .map(normalize);
  }
  function matches(s, filters = {}) {
    if (
      ["platform", "kind", "status", "agent", "activity"].some(
        (k) => filters[k] && filters[k] !== "all" && (s[k] || "unknown") !== filters[k],
      )
    )
      return false;
    const query = text(filters.query).trim().toLowerCase();
    return (
      !query ||
      [s.label, s.channelName, s.agent, s.model, s.operator, s.key, s.channelId]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }
  function select(sessions, filters = {}, sort = "recent") {
    return sessions
      .filter((s) => matches(s, filters))
      .sort((a, b) => {
        const diff =
          sort === "tokens"
            ? (b.tokens ?? -1) - (a.tokens ?? -1)
            : sort === "name"
              ? a.label.localeCompare(b.label)
              : (a.age ?? Infinity) - (b.age ?? Infinity);
        return (Number.isNaN(diff) ? 0 : diff) || a.id.localeCompare(b.id);
      });
  }
  function groups(sessions, by) {
    const result = new Map();
    for (const s of sessions) {
      const key =
        by === "channel"
          ? s.channelKey
          : ["agent", "platform", "kind", "activity"].includes(by)
            ? s[by] || "unknown"
            : "all";
      if (!result.has(key))
        result.set(key, {
          key,
          label: by === "channel" ? s.channelName : key,
          platform: s.platform,
          account: s.account,
          channelId: s.channelId,
          items: [],
        });
      result.get(key).items.push(s);
    }
    return [...result.values()].sort(
      (a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label),
    );
  }
  const api = { normalize, visible, matches, select, groups };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SessionExplorerModel = api;
})(typeof globalThis === "object" ? globalThis : this);
