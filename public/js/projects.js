/* Read-only portfolio; tracker adapters and synchronization live outside this UI. */
(function () {
  "use strict";

  const STAGES = ["inbox", "planned", "doing", "review", "done", "canceled", "unknown"];
  const HEALTH = ["on-track", "at-risk", "blocked", "off-track", "unknown"];
  const LABELS = {
    all: "All",
    refresh: "Refresh snapshots",
    refreshing: "Loading snapshots…",
    loading: "Loading project snapshots…",
    error: "Project snapshots could not be loaded. Try Refresh snapshots.",
    retained: "Refresh failed. Showing previous snapshots; source data is not current.",
    noSources:
      "No project sources configured. Command Center works on its own; add Spacesuit tracker adapters to populate this board.",
    empty: "No projects reported. Check source freshness above.",
    noMatches: "No projects match these filters.",
    visible: "{count} projects shown · {total} reported",
    partial: "Some sources are incomplete or unavailable. Check source freshness above.",
    emptyColumn: "No projects",
    source: "Source",
    health: "Delivery health",
    owner: "Owner",
    unassigned: "Unassigned",
    nativeStatus: "Tracker status",
    tasks: "Tasks",
    taskCounts: "{done} done / {total} total · {blocked} blocked",
    taskNote: "Task counts are not a project completion estimate.",
    agents: "Linked agents",
    noAgents: "None linked",
    sessions: "Linked sessions",
    dependencies: "Dependencies",
    unresolved: "Not in this snapshot",
    target: "Target date",
    updated: "Project updated",
    observed: "Snapshot observed",
    unknown: "Unknown",
    open: "Open in tracker ↗",
    sourceData: "Source data",
    snapshotOnly: "Collected snapshot, not a live tracker connection",
    kind: { project: "Project", epic: "Epic", milestone: "Milestone" },
    stage: {
      inbox: "Inbox",
      planned: "Planned",
      doing: "Doing",
      review: "In Review",
      done: "Done",
      canceled: "Canceled",
      unknown: "Unmapped",
    },
    healthState: {
      "on-track": "On track",
      "at-risk": "At risk",
      blocked: "Blocked",
      "off-track": "Off track",
      unknown: "Health unknown",
    },
    sourceState: {
      ready: "Ready",
      partial: "Partial",
      error: "Error",
      unavailable: "Unavailable",
      loading: "Loading",
      disabled: "Disabled",
      stale: "Stale",
    },
  };
  let snapshot = null;
  let busy = false;
  let failed = false;
  let freshnessTimer = null;
  const FRESHNESS_MS = 5 * 60 * 1000;
  const filters = { query: "", source: "", health: "", agent: "" };
  const byId = (id) => document.getElementById(id);
  function t(key, params = {}) {
    const fallback = key.split(".").reduce((value, part) => value?.[part], LABELS) || key;
    if (window.I18N?.t) return window.I18N.t(`projectBoard.${key}`, params, fallback);
    return fallback.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
  }
  function node(tag, text, className, raw = false) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = String(text);
    if (className) el.className = className;
    if (raw) el.dataset.i18nSkip = "true";
    return el;
  }
  function safeUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
    } catch {
      return null;
    }
  }
  const identity = (sourceId, projectId) => JSON.stringify([sourceId, projectId]);
  function entries(data) {
    return (data?.sources || []).flatMap((source) =>
      (source.projects || []).map((project) => ({ source, project })),
    );
  }
  function match(entry, selected = filters) {
    const { source, project } = entry;
    const query = selected.query.toLocaleLowerCase().trim();
    return (
      (!selected.source || source.id === selected.source) &&
      (!selected.health || project.health === selected.health) &&
      (!selected.agent || (project.agents || []).includes(selected.agent)) &&
      (!query ||
        [
          project.title,
          project.id,
          project.summary,
          project.owner,
          source.label,
          project.nativeStatus,
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query))
    );
  }
  function formatDate(value, dateOnly = false) {
    if (!value) return t("unknown");
    if (dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? date.toLocaleString(window.I18N?.getLocale?.() || "en")
      : t("unknown");
  }
  function field(list, label, value, raw = false) {
    const row = node("div");
    row.append(node("dt", t(label)), node("dd", value, undefined, raw));
    list.append(row);
  }
  function card(entry, lookup) {
    const { source, project } = entry;
    const el = node("article", undefined, "project-card");
    el.dataset.projectId = project.id;
    el.dataset.sourceId = source.id;
    const tags = node("div", undefined, "project-card-tags");
    tags.append(node("span", `${source.provider} · ${source.label}`, "project-tag", true));
    tags.append(node("span", t(`kind.${project.kind}`), "project-tag"));
    const health = HEALTH.includes(project.health) ? project.health : "unknown";
    const healthTag = node("span", t(`healthState.${health}`), "project-tag");
    healthTag.dataset.health = health;
    tags.append(healthTag);
    if (sourceStatus(source) !== "ready") {
      const status = sourceStatus(source);
      const warning = node(
        "span",
        `${t("sourceData")}: ${t(`sourceState.${status}`)}`,
        "project-tag",
      );
      warning.dataset.status = status;
      tags.append(warning);
    }
    el.append(tags, node("h3", project.title, undefined, true));
    el.append(node("p", project.id, "project-card-note", true));
    if (project.summary) el.append(node("p", project.summary, "project-card-summary", true));
    const meta = node("dl", undefined, "project-card-meta");
    field(
      meta,
      "nativeStatus",
      project.nativeStatus || t("unknown"),
      Boolean(project.nativeStatus),
    );
    field(meta, "owner", project.owner || t("unassigned"), Boolean(project.owner));
    const count = (name) => (Number.isInteger(project.counts?.[name]) ? project.counts[name] : "?");
    field(
      meta,
      "tasks",
      t("taskCounts", { done: count("done"), total: count("total"), blocked: count("blocked") }),
    );
    field(
      meta,
      "agents",
      project.agents?.length ? project.agents.join(", ") : t("noAgents"),
      Boolean(project.agents?.length),
    );
    field(meta, "updated", formatDate(project.updatedAt));
    if (project.targetDate) field(meta, "target", formatDate(project.targetDate, true));
    el.append(meta, node("p", t("taskNote"), "project-card-note"));
    if (project.sessionKeys?.length) {
      const details = node("details", undefined, "project-dependencies");
      details.append(node("summary", `${t("sessions")} (${project.sessionKeys.length})`));
      const list = node("ul");
      project.sessionKeys.forEach((key) => list.append(node("li", key, undefined, true)));
      details.append(list);
      el.append(details);
    }
    if (project.dependencies?.length) {
      const details = node("details", undefined, "project-dependencies");
      details.append(node("summary", `${t("dependencies")} (${project.dependencies.length})`));
      const list = node("ul");
      for (const dependency of project.dependencies) {
        const target = lookup.get(identity(dependency.sourceId, dependency.projectId));
        const item = node("li");
        item.append(
          node(
            "span",
            `${dependency.sourceId} / ${target?.project.title || dependency.projectId}`,
            undefined,
            true,
          ),
        );
        if (!target) item.append(node("span", ` — ${t("unresolved")}`));
        list.append(item);
      }
      details.append(list);
      el.append(details);
    }
    const url = safeUrl(project.url);
    if (url) {
      const link = node("a", t("open"));
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      el.append(link);
    }
    return el;
  }
  function sourceStatus(source) {
    if (!["ready", "partial"].includes(source.status)) return source.status;
    const expires = Date.parse(source.observedAt) + FRESHNESS_MS;
    return failed || !Number.isFinite(expires) || Date.now() >= expires ? "stale" : source.status;
  }
  // Only age local labels; this timer never fetches, polls or creates a stream.
  function scheduleFreshness() {
    if (freshnessTimer !== null) clearTimeout(freshnessTimer);
    freshnessTimer = null;
    if (failed) return;
    const now = Date.now();
    const deadlines = (snapshot?.sources || [])
      .filter((source) => ["ready", "partial"].includes(source.status))
      .map((source) => Date.parse(source.observedAt) + FRESHNESS_MS)
      .filter((expires) => Number.isFinite(expires) && expires > now);
    if (deadlines.length) freshnessTimer = setTimeout(render, Math.min(...deadlines) - now);
  }
  function renderSources() {
    const root = byId("projects-sources");
    root.replaceChildren();
    for (const source of snapshot?.sources || []) {
      const el = node("article", undefined, "project-source");
      const status = sourceStatus(source);
      const badge = node("span", t(`sourceState.${status}`), "project-tag");
      badge.dataset.status = status;
      el.append(
        node("strong", `${source.label} · ${source.provider} (${source.id})`, undefined, true),
        node("span", " "),
        badge,
      );
      if (status === "stale" && source.status === "partial") {
        const incomplete = node("span", t("sourceState.partial"), "project-tag");
        incomplete.dataset.status = "partial";
        el.append(node("span", " "), incomplete);
      }
      el.append(
        node("p", `${t("observed")}: ${formatDate(source.observedAt)}`),
        node("p", t("snapshotOnly")),
      );
      root.append(el);
    }
    scheduleFreshness();
  }
  function options(id, values) {
    const select = byId(id);
    const prior = select.value;
    select.replaceChildren();
    const all = node("option", t("all"));
    all.value = "";
    select.append(all);
    for (const [value, label, raw] of values) {
      const option = node("option", label, undefined, raw);
      option.value = value;
      select.append(option);
    }
    select.value = values.some(([value]) => value === prior) ? prior : "";
    return select.value;
  }
  function renderFilters() {
    filters.source = options(
      "projects-source",
      (snapshot?.sources || []).map((source) => [
        source.id,
        `${source.label} (${source.provider} / ${source.id})`,
        true,
      ]),
    );
    filters.health = options(
      "projects-health",
      HEALTH.map((health) => [health, t(`healthState.${health}`), false]),
    );
    filters.agent = options(
      "projects-agent",
      [...new Set(entries(snapshot).flatMap(({ project }) => project.agents || []))]
        .sort()
        .map((agent) => [agent, agent, true]),
    );
  }
  function render() {
    const root = byId("projects-board");
    const message = byId("projects-message");
    root.replaceChildren();
    root.setAttribute("aria-busy", busy ? "true" : "false");
    const button = byId("projects-refresh");
    button.disabled = busy;
    button.textContent = t(busy ? "refreshing" : "refresh");
    message.className = `projects-message${failed ? " is-error" : ""}`;
    renderSources();
    if (!snapshot) {
      message.textContent = t(failed ? "error" : "loading");
      return;
    }
    const all = entries(snapshot);
    const visible = all.filter((entry) => match(entry));
    let notice = !snapshot.sources?.length
      ? t("noSources")
      : !all.length
        ? t("empty")
        : !visible.length
          ? t("noMatches")
          : t("visible", { count: visible.length, total: all.length });
    if (snapshot.status === "error" && !snapshot.sources?.length) notice = t("error");
    if (failed) notice = `${t("retained")} ${notice}`;
    else if (snapshot.status !== "ready" && snapshot.sources?.length)
      notice = `${t("partial")} ${notice}`;
    message.textContent = notice;
    if (!snapshot.sources?.length) return;
    const lookup = new Map(
      all.map((entry) => [identity(entry.source.id, entry.project.id), entry]),
    );
    for (const stage of STAGES) {
      const group = visible.filter(
        ({ project }) => (STAGES.includes(project.stage) ? project.stage : "unknown") === stage,
      );
      const column = node("section", undefined, "project-column");
      column.dataset.stage = stage;
      const heading = node("h2", undefined, "project-column-heading");
      heading.id = `project-stage-${stage}`;
      column.setAttribute("aria-labelledby", heading.id);
      heading.append(
        node("span", t(`stage.${stage}`)),
        node("span", group.length, "project-column-count"),
      );
      const body = node("div", undefined, "project-column-body");
      if (!group.length) body.append(node("p", t("emptyColumn"), "project-column-empty"));
      group.forEach((entry) => body.append(card(entry, lookup)));
      column.append(heading, body);
      root.append(column);
    }
  }
  async function refresh() {
    if (busy) return;
    busy = true;
    render();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch("api/projects", {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Project request failed");
      const data = await response.json();
      if (data.schemaVersion !== 1 || !Array.isArray(data.sources))
        throw new Error("Invalid project response");
      snapshot = data;
      failed = false;
      renderFilters();
    } catch {
      failed = true;
    } finally {
      clearTimeout(timer);
      busy = false;
      render();
    }
  }
  function init() {
    if (!byId("projects-board")) return;
    renderFilters();
    byId("projects-filters").addEventListener("submit", (event) => event.preventDefault());
    byId("projects-search").addEventListener("input", (event) => {
      filters.query = event.target.value;
      render();
    });
    for (const key of ["source", "health", "agent"])
      byId(`projects-${key}`).addEventListener("change", (event) => {
        filters[key] = event.target.value;
        render();
      });
    byId("projects-refresh").addEventListener("click", refresh);
    byId("projects-menu").addEventListener("click", () => {
      const open = byId("sidebar")?.classList.toggle("visible") || false;
      byId("projects-menu").setAttribute("aria-expanded", String(open));
    });
    window.addEventListener("i18n:updated", () => {
      renderFilters();
      render();
    });
    refresh();
  }
  window.ProjectBoard = { refresh, safeUrl, identity, match, labels: LABELS };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
