/* Session identity is local to this dashboard/profile. Titles never establish links. */
(function (root) {
  const graphModel =
    typeof module === "object" && module.exports
      ? require("./operations-model")
      : root.OperationsModel;
  const text = (v) => (typeof v === "string" ? v : "");
  const number = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  function build(sessions, graph, privacy, includeInferred = false) {
    if (!Array.isArray(privacy?.hiddenSessions)) throw Error("Privacy unavailable");
    const hidden = new Set(privacy.hiddenSessions.map((s) => text(s.id).trim().toLowerCase()));
    const seen = new Set();
    const items = sessions
      .filter((s) => {
        const key = text(s.sessionKey).trim().toLowerCase();
        if (!key || hidden.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((s) => {
        const key = text(s.sessionKey),
          parts = key.split(":"),
          age = number(s.minutesAgo);
        const agent = text(s.agentId) || (parts[0] === "agent" ? parts[1] : "");
        const channel = text(s.channelId),
          platform = text(s.channel) || "other";
        const account = text(s.channelAccount);
        const title = text(s.label);
        return {
          key,
          title:
            title.startsWith("agent:") ||
            (channel && title.toLowerCase().includes(channel.toLowerCase()))
              ? ""
              : title,
          agent,
          platform,
          account,
          channel,
          channelName: text(s.channelName),
          model: text(s.model),
          kind: text(s.sessionType) || "unknown",
          age,
          tokens: number(s.lifetimeTokens),
          input: number(s.inputTokens),
          output: number(s.outputTokens),
          status:
            s.active === true
              ? "live"
              : s.recentlyActive === true
                ? "recent"
                : age === null
                  ? "unknown"
                  : "idle",
          facets: {
            channel: [
              {
                id: JSON.stringify([platform, account, channel || key]),
                title: text(s.channelName),
                hint: platform,
              },
            ],
            agent: [{ id: agent || "unknown", title: agent }],
            activity: [
              {
                id:
                  age === null
                    ? "unknown"
                    : age < 60
                      ? "hour"
                      : age < 1440
                        ? "day"
                        : age < 10080
                          ? "week"
                          : "older",
                title: "",
              },
            ],
            outcome: [],
            role: [],
            topic: [],
          },
        };
      });
    const byKey = new Map(items.map((s) => [s.key.toLowerCase(), s]));
    for (const lens of ["outcome", "role", "topic"]) {
      const view = graphModel.view(graph, {
        lens,
        includeInferred,
        hiddenSessions: privacy.hiddenSessions,
      });
      for (const group of view.groups)
        for (const run of group.runs) {
          const item = byKey.get(text(run.sessionKey).toLowerCase());
          if (item && !item.facets[lens].some((f) => f.id === group.seed.id))
            item.facets[lens].push({ id: group.seed.id, title: group.seed.title });
        }
    }
    for (const item of items)
      for (const lens of ["outcome", "role", "topic"])
        if (!item.facets[lens].length) item.facets[lens].push({ id: "unassigned", title: "" });
    return items;
  }
  function select(items, { query = "", status = "all", trail = [], sort = "recent" } = {}) {
    const q = query.trim().toLowerCase();
    return items
      .filter(
        (s) =>
          (status === "all" || s.status === status) &&
          trail.every((f) => s.facets[f.lens]?.some((x) => x.id === f.id)) &&
          (!q ||
            [
              s.title,
              s.channelName,
              s.agent,
              s.model,
              ...Object.values(s.facets)
                .flat()
                .map((f) => f.title),
            ]
              .join(" ")
              .toLowerCase()
              .includes(q)),
      )
      .sort((a, b) => {
        const delta =
          sort === "tokens"
            ? (b.tokens ?? -1) - (a.tokens ?? -1)
            : (a.age ?? Infinity) - (b.age ?? Infinity);
        return (Number.isNaN(delta) ? 0 : delta) || a.key.localeCompare(b.key);
      });
  }
  function groups(items, lens) {
    const map = new Map();
    for (const item of items)
      for (const facet of item.facets[lens] || []) {
        if (!map.has(facet.id)) map.set(facet.id, { ...facet, items: [] });
        map.get(facet.id).items.push(item);
      }
    return [...map.values()].sort(
      (a, b) => b.items.length - a.items.length || a.id.localeCompare(b.id),
    );
  }
  const api = { build, select, groups };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OperationsAtlasModel = api;
})(typeof globalThis === "object" ? globalThis : this);
