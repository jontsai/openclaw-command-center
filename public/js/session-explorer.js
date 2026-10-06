(function () {
  "use strict";
  const M = window.SessionExplorerModel;
  const byId = (id) => document.getElementById(`explorer-${id}`);
  const t = (key, params = {}) => window.I18N?.t(`explorer.${key}`, params, key) || key;
  let sessions = [],
    total = 0,
    fetchedAt = null,
    busy = false,
    failed = false;
  let filters = {},
    groupBy = "channel",
    sort = "recent",
    selectedGroup = null,
    selected = null,
    limit = 50;
  function node(tag, value, className) {
    const el = document.createElement(tag);
    if (value !== undefined) el.textContent = value;
    if (className) el.className = className;
    return el;
  }
  const known = new Set([
    "unknown",
    "all",
    "main",
    "subagent",
    "cron",
    "channel",
    "live",
    "recent",
    "idle",
    "hour",
    "day",
    "week",
    "older",
  ]);
  const label = (value) => (known.has(value) ? t(value) : value);
  const name = (s) => s.label || `${label(s.kind)} · ${s.agent || t("unknown")}`;
  function options(id, values, value, translate = true) {
    const select = byId(id);
    select.replaceChildren(
      ...values.map((v) => {
        const option = node("option", translate ? label(v) : v);
        option.value = v;
        return option;
      }),
    );
    select.value = value;
  }
  function renderFilters() {
    for (const key of ["platform", "kind", "status", "agent", "activity"]) {
      const values = [...new Set(sessions.map((s) => s[key] || "unknown"))].sort();
      if (filters[key] && filters[key] !== "all" && !values.includes(filters[key]))
        values.push(filters[key]);
      options(key, ["all", ...values], filters[key] || "all", key !== "agent");
      if (key === "agent") byId(key).firstChild.textContent = t("all");
    }
    for (const [id, values, value] of [
      ["group", ["channel", "agent", "platform", "kind", "activity", "none"], groupBy],
      ["sort", ["recent", "tokens", "name"], sort],
    ]) {
      options(id, values, value);
      [...byId(id).options].forEach((o) => {
        o.textContent = t(`${id}_${o.value}`);
      });
    }
  }
  function groupLabel(group) {
    return groupBy === "channel"
      ? group.label || t("unresolvedChannel")
      : groupBy === "agent"
        ? group.label || t("unknown")
        : label(group.label);
  }
  function row(title, description, active, click) {
    const button = node("button", undefined, "explorer-row");
    button.type = "button";
    button.setAttribute("aria-pressed", String(active));
    button.append(node("strong", title), node("small", description));
    button.addEventListener("click", click);
    return button;
  }
  function inspect(s) {
    const root = byId("inspector");
    root.replaceChildren();
    if (!s) {
      root.append(node("p", t("selectSession")));
      return;
    }
    root.append(node("h3", name(s)), node("p", t("metadataOnly")));
    const dl = node("dl");
    const values = {
      agent: s.agent || t("unknown"),
      platform: label(s.platform),
      channel: s.channelName || t("unresolvedChannel"),
      account: s.account || t("defaultAccount"),
      kind: label(s.kind),
      status: label(s.status),
      model: s.model || t("unknown"),
      operator: s.operator || t("unknown"),
      lastActivity: s.age === null ? t("unknown") : t("minutes", { n: s.age }),
      tokens: s.tokens === null ? t("unknown") : s.tokens.toLocaleString(),
      resolution: s.resolution === "unknown" ? t("unknown") : t(`resolution_${s.resolution}`),
    };
    for (const [key, value] of Object.entries(values))
      dl.append(node("dt", t(key)), node("dd", value));
    root.append(dl);
    const details = node("details");
    details.append(
      node("summary", t("identifiers")),
      node("code", s.key),
      node("code", s.channelId),
    );
    root.append(details);
  }
  function render() {
    byId("refresh").disabled = busy;
    byId("health").dataset.failed = String(failed);
    byId("health").textContent = busy
      ? t("loading")
      : failed
        ? t("failed")
        : fetchedAt
          ? t("coverage", { loaded: sessions.length, total, time: fetchedAt.toLocaleTimeString() })
          : t("loading");
    const matched = M.select(sessions, filters, sort);
    const groups = M.groups(matched, groupBy);
    if (selectedGroup !== null && !groups.some((g) => g.key === selectedGroup))
      selectedGroup = null;
    const list =
      selectedGroup === null ? matched : groups.find((g) => g.key === selectedGroup).items;
    byId("count").textContent = t("count", {
      n: list.length,
      matched: matched.length,
      groups: groups.length,
    });
    const rail = byId("groups");
    rail.replaceChildren();
    rail.append(
      row(t("allGroups"), String(matched.length), selectedGroup === null, () => {
        selectedGroup = null;
        limit = 50;
        render();
      }),
    );
    for (const group of groups) {
      const description =
        groupBy === "channel"
          ? `${group.items.length} · ${label(group.platform)} · ${group.account || t("defaultAccount")}`
          : String(group.items.length);
      const button = row(groupLabel(group), description, selectedGroup === group.key, () => {
        selectedGroup = group.key;
        limit = 50;
        render();
      });
      button.title = groupBy === "channel" ? group.channelId : "";
      rail.append(button);
    }
    const root = byId("sessions");
    root.replaceChildren();
    if (!list.some((s) => s.id === selected)) selected = null;
    if (!list.length) root.append(node("p", t("empty")));
    for (const s of list.slice(0, limit)) {
      const description = `${s.agent || t("unknown")} · ${label(s.platform)} · ${label(s.status)} · ${s.model || t("unknown")}`;
      const button = row(name(s), description, selected === s.id, () => {
        selected = s.id;
        render();
        byId("inspector").scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
      button.title = s.channelId;
      root.append(button);
    }
    byId("more").hidden = list.length <= limit;
    inspect(list.find((s) => s.id === selected));
  }
  async function read(url, signal) {
    const response = await fetch(url, { signal, cache: "no-store" });
    if (!response.ok) throw new Error("Unavailable");
    const reader = response.body.getReader(),
      chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 8 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("Oversized response");
      }
      chunks.push(value);
    }
    const buffer = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(buffer));
  }
  async function refresh() {
    if (busy) return;
    busy = true;
    render();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const privacy = await read("api/privacy", controller.signal);
      if (!Array.isArray(privacy.hiddenSessions)) throw new Error("Invalid privacy response");
      const data = await read("api/sessions?pageSize=1000&page=1", controller.signal);
      if (
        !Array.isArray(data.sessions) ||
        !Number.isInteger(data.pagination?.total) ||
        data.pagination.total < 0
      )
        throw new Error("Invalid session response");
      sessions = M.visible(data.sessions.slice(0, 1000), privacy);
      total = data.pagination.total;
      fetchedAt = new Date();
      failed = false;
    } catch {
      // Fail closed: a failed privacy refresh must not leave newly hidden sessions visible.
      sessions = [];
      selected = null;
      failed = true;
    } finally {
      clearTimeout(timer);
      busy = false;
      renderFilters();
      render();
    }
  }
  function init() {
    renderFilters();
    render();
    byId("filters").addEventListener("submit", (e) => e.preventDefault());
    byId("query").addEventListener("input", (e) => {
      filters.query = e.target.value;
      selectedGroup = null;
      limit = 50;
      render();
    });
    for (const key of ["platform", "kind", "status", "agent", "activity"])
      byId(key).addEventListener("change", (e) => {
        filters[key] = e.target.value;
        selectedGroup = null;
        limit = 50;
        render();
      });
    byId("group").addEventListener("change", (e) => {
      groupBy = e.target.value;
      selectedGroup = null;
      limit = 50;
      render();
    });
    byId("sort").addEventListener("change", (e) => {
      sort = e.target.value;
      render();
    });
    byId("more").addEventListener("click", () => {
      limit += 50;
      render();
    });
    byId("clear").addEventListener("click", () => {
      filters = {};
      selectedGroup = null;
      limit = 50;
      byId("query").value = "";
      renderFilters();
      render();
    });
    byId("refresh").addEventListener("click", refresh);
    byId("menu").addEventListener("click", () => {
      const open = document.getElementById("sidebar")?.classList.toggle("visible") || false;
      byId("menu").setAttribute("aria-expanded", String(open));
    });
    window.addEventListener("i18n:updated", () => {
      renderFilters();
      render();
    });
    refresh();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
