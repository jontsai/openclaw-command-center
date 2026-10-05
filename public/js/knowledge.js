(function () {
  "use strict";
  const labels = {
    title: "Knowledge explorer",
    eyebrow: "MEMORY · TOPICS · EVIDENCE",
    intro: "Explore what your agents know—and where it came from.",
    refresh: "Reload snapshot",
    search: "Filter titles and previews",
    searchNote: "Local filtering—not semantic retrieval.",
    topics: "Topic hierarchy",
    documents: "Documents",
    all: "All knowledge",
    empty: "No documents match this view.",
    select: "Choose a document to inspect its source and preview.",
    unavailable:
      "No knowledge snapshot configured. Add a Spacesuit knowledge collector to populate this view.",
    error: "Knowledge snapshot unavailable or invalid. Reload after checking the collector.",
    failed: "Reload failed. The previous view has been cleared; it is not current.",
    loading: "Loading knowledge…",
    shown: "{count} documents in this view",
    collected: "Collected",
    indexed: "Latest source update",
    unknown: "Unknown",
    source: "Source reference",
    adapter: "Adapter",
    updated: "Document updated",
    preview: "Source preview",
    truncated: "Excerpt only; open the original source for the complete document.",
    open: "Open original source ↗",
    ready: "Snapshot ready",
    partial: "Partial coverage",
    stale: "Snapshot stale",
    document: "Document",
    folder: "Folder",
    topic: "Topic",
    footnote:
      "Read-only excerpts. Relationships are supplied by adapters; nothing is inferred from similar titles. QMD collection snapshots are supported through Spacesuit; semantic search is not connected.",
  };
  let data = null,
    scope = null,
    selected = null,
    query = "",
    busy = false,
    failed = false;
  const $ = (id) => document.getElementById(`knowledge-${id}`);
  const t = (key, params = {}) =>
    window.I18N?.t
      ? window.I18N.t(`knowledge.${key}`, params, labels[key])
      : (labels[key] || key).replace(/\{(\w+)\}/g, (_, k) => params[k] ?? "");
  function el(tag, text, cls, raw = false) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    if (raw) n.dataset.i18nSkip = "true";
    return n;
  }
  const identity = (s, d) => JSON.stringify([s, d]);
  const date = (v) =>
    v ? new Date(v).toLocaleString(window.I18N?.getLocale?.() || undefined) : t("unknown");
  function descendants(doc, parent, lookup) {
    let node = doc;
    const seen = new Set();
    while (node && !seen.has(node.id)) {
      if (node.id === parent) return true;
      seen.add(node.id);
      node = lookup.get(node.parentId);
    }
    return false;
  }
  function matches(doc, q) {
    return `${doc.title}\n${doc.excerpt}\n${doc.sourceRef}`
      .toLocaleLowerCase()
      .includes(q.toLocaleLowerCase());
  }
  function chooseScope(next) {
    scope = next;
    selected = null;
    render();
  }
  function tree() {
    const root = $("tree");
    root.replaceChildren();
    const all = el("button", t("all"));
    all.type = "button";
    all.setAttribute("aria-pressed", String(!scope));
    all.onclick = () => chooseScope(null);
    root.append(all);
    for (const source of data?.sources || []) {
      const group = el("details");
      group.open = true;
      group.append(el("summary", source.label, "", true));
      const btn = el("button", t("all"));
      btn.type = "button";
      btn.setAttribute(
        "aria-pressed",
        String(scope?.source === source.id && scope.parent === null),
      );
      btn.onclick = () => chooseScope({ source: source.id, parent: null });
      group.append(btn);
      const folders = source.documents.filter((d) => d.kind !== "document");
      function add(parent, container, depth = 0) {
        if (depth > 20) return;
        for (const d of folders.filter((x) => x.parentId === parent)) {
          const branch = el("details");
          branch.open = true;
          branch.append(el("summary", d.title, "", true));
          const view = el("button", t("documents"));
          view.type = "button";
          view.setAttribute(
            "aria-pressed",
            String(scope?.source === source.id && scope.parent === d.id),
          );
          view.onclick = () => chooseScope({ source: source.id, parent: d.id });
          branch.append(view);
          add(d.id, branch, depth + 1);
          container.append(branch);
        }
      }
      add(null, group);
      root.append(group);
    }
  }
  function reader(entry) {
    const root = $("reader");
    root.replaceChildren();
    root.append(el("h2", t("preview")));
    if (!entry) {
      root.append(el("p", t("select"), "knowledge-empty"));
      return;
    }
    const { source, doc } = entry;
    const lookup = new Map(source.documents.map((d) => [d.id, d]));
    const crumbs = [doc.title];
    let p = lookup.get(doc.parentId);
    while (p && crumbs.length < 21) {
      crumbs.unshift(p.title);
      p = lookup.get(p.parentId);
    }
    root.append(el("p", [source.label, ...crumbs].join(" / "), "knowledge-breadcrumb", true));
    root.append(el("h3", doc.title, "", true));
    const dl = el("dl");
    for (const [key, value] of [
      ["source", doc.sourceRef],
      ["adapter", source.adapter],
      ["updated", date(doc.updatedAt)],
    ]) {
      dl.append(el("dt", t(key)), el("dd", value, "", true));
    }
    root.append(dl);
    if (doc.truncated) root.append(el("p", t("truncated"), "knowledge-empty"));
    root.append(el("pre", doc.excerpt, "", true));
    if (doc.url) {
      try {
        const url = new URL(doc.url);
        if (url.protocol === "https:" && !url.username && !url.password) {
          const a = el("a", t("open"));
          a.href = url.href;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          root.append(a);
        }
      } catch {
        /* No unsafe source navigation. */
      }
    }
  }
  function render() {
    $("refresh").disabled = busy;
    const sources = $("sources");
    sources.replaceChildren();
    for (const s of data?.sources || []) {
      const card = el("section", undefined, "knowledge-source");
      card.append(el("h3", s.label, "", true));
      const status =
        s.status === "ready" && (s.stale || Date.now() - Date.parse(s.observedAt) > 900000)
          ? "stale"
          : s.status;
      card.append(
        el(
          "p",
          `${s.adapter} · ${t(status)}`,
          `knowledge-status ${status === "ready" ? "" : "warning"}`,
          true,
        ),
      );
      card.append(el("p", `${t("collected")}: ${date(s.observedAt)}`));
      card.append(el("p", `${t("indexed")}: ${date(s.indexUpdatedAt)}`));
      sources.append(card);
    }
    tree();
    const entries = [];
    for (const source of data?.sources || []) {
      if (scope && source.id !== scope.source) continue;
      const lookup = new Map(source.documents.map((d) => [d.id, d]));
      for (const doc of source.documents) {
        if (
          doc.kind === "folder" ||
          (scope?.parent && !descendants(doc, scope.parent, lookup)) ||
          !matches(doc, query)
        )
          continue;
        entries.push({ source, doc });
      }
    }
    const list = $("list");
    list.replaceChildren();
    for (const entry of entries) {
      const { source, doc } = entry;
      const key = identity(source.id, doc.id);
      const button = el("button", undefined, "knowledge-document");
      button.type = "button";
      button.setAttribute("aria-pressed", String(selected === key));
      button.append(
        el("small", source.label, "", true),
        el("strong", doc.title, "", true),
        el("p", doc.excerpt.slice(0, 130).replace(/\s+/g, " "), "", true),
      );
      button.onclick = () => {
        selected = key;
        render();
      };
      list.append(button);
    }
    if (!entries.length) list.append(el("p", t("empty"), "knowledge-empty"));
    reader(entries.find((e) => identity(e.source.id, e.doc.id) === selected));
    const status = !data || data.status !== "ready" ? data?.status || "unavailable" : null;
    $("message").textContent = busy
      ? t("loading")
      : failed
        ? t("failed")
        : status
          ? t(status)
          : t("shown", { count: entries.length });
  }
  async function refresh() {
    if (busy) return;
    busy = true;
    render();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch("api/knowledge", {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error("unavailable");
      const result = await response.json();
      if (result.schemaVersion !== 1 || !Array.isArray(result.sources)) throw new Error("invalid");
      data = result;
      failed = false;
    } catch {
      data = null;
      failed = true;
    } finally {
      clearTimeout(timer);
      busy = false;
      render();
    }
  }
  function init() {
    $("search-form").onsubmit = (e) => e.preventDefault();
    $("search").oninput = (e) => {
      query = e.target.value;
      render();
    };
    $("refresh").onclick = refresh;
    $("menu").onclick = () =>
      $("menu").setAttribute(
        "aria-expanded",
        String(document.getElementById("sidebar")?.classList.toggle("visible") || false),
      );
    window.addEventListener("i18n:updated", render);
    setInterval(() => {
      if (!document.hidden && !busy) render();
    }, 60000);
    refresh();
  }
  window.KnowledgeExplorer = { matches, descendants, identity, labels };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
