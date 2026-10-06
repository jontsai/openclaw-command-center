(function () {
  const $ = (id) => document.getElementById("op-" + id),
    t = (k, p = {}) => window.I18N?.t("operations." + k, p, k) || k;
  const el = (tag, value, cls) => {
    const n = document.createElement(tag);
    if (value !== undefined) n.textContent = value;
    if (cls) n.className = cls;
    return n;
  };
  let graph = { nodes: [], edges: [], sources: [], status: "unavailable" },
    privacy = [],
    selected = null,
    focused = null,
    busy = false,
    failed = false;
  const stateName = (s) => t("state_" + s);
  function inspectNode(n, view) {
    focused = n.id;
    const box = $("inspector");
    box.replaceChildren(el("h3", n.title), el("p", stateName(n.state)));
    if (n.nativeStatus) box.append(el("p", t("native", { state: n.nativeStatus })));
    box.append(el("p", t("observed", { time: n.observedAt })));
    for (const e of graph.edges.filter(
      (e) => (e.from === n.id || e.to === n.id) && view.index.has(e.from) && view.index.has(e.to),
    )) {
      const other = view.index.get(e.from === n.id ? e.to : e.from);
      const line = el(
        "button",
        `${e.basis === "inferred" ? t("inferred") : t("observedLink")} · ${t("relation_" + e.relation)} · ${other.title}`,
        "btn-secondary",
      );
      line.title = e.evidence;
      line.onclick = () => inspectNode(other, view);
      box.append(line, el("p", e.evidence));
    }
    const d = el("details");
    d.append(el("summary", t("ids")), el("code", n.id));
    if (n.sessionKey) d.append(el("code", n.sessionKey));
    box.append(d);
  }
  function draw(group, view) {
    const root = $("graph");
    root.replaceChildren();
    if (!group) return;
    const chosen = [group.seed, ...group.tasks, ...group.runs]
      .filter((n, i, a) => a.findIndex((x) => x.id === n.id) === i)
      .slice(0, 40);
    const ns = "http://www.w3.org/2000/svg",
      svg = document.createElementNS(ns, "svg");
    svg.setAttribute("role", "group");
    svg.setAttribute("aria-label", t("connections"));
    const positions = new Map(),
      counts = [0, 0, 0];
    for (const n of chosen) {
      const col = n.id === group.seed.id ? 0 : n.kind === "run" ? 2 : 1;
      positions.set(n.id, { x: 20 + col * 290, y: 20 + counts[col]++ * 75 });
    }
    svg.setAttribute("viewBox", `0 0 880 ${Math.max(...counts) * 75 + 40}`);
    for (const e of view.edges) {
      if (!positions.has(e.from) || !positions.has(e.to)) continue;
      const a = positions.get(e.from),
        b = positions.get(e.to),
        line = document.createElementNS(ns, "line");
      line.setAttribute("x1", a.x + 110);
      line.setAttribute("y1", a.y + 23);
      line.setAttribute("x2", b.x + 110);
      line.setAttribute("y2", b.y + 23);
      line.dataset.basis = e.basis;
      const title = document.createElementNS(ns, "title");
      title.textContent = t("relation_" + e.relation) + " · " + e.evidence;
      line.append(title);
      svg.append(line);
    }
    for (const n of chosen) {
      const p = positions.get(n.id),
        g = document.createElementNS(ns, "g"),
        rect = document.createElementNS(ns, "rect"),
        label = document.createElementNS(ns, "text");
      g.dataset.state = n.state;
      g.setAttribute("role", "button");
      g.setAttribute("tabindex", "0");
      g.setAttribute("aria-label", n.title);
      rect.setAttribute("x", p.x);
      rect.setAttribute("y", p.y);
      rect.setAttribute("width", "240");
      rect.setAttribute("height", "48");
      rect.setAttribute("rx", "8");
      label.setAttribute("x", p.x + 10);
      label.setAttribute("y", p.y + 28);
      label.textContent = n.title.length > 31 ? n.title.slice(0, 29) + "…" : n.title;
      g.append(rect, label);
      g.onclick = () => inspectNode(n, view);
      g.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inspectNode(n, view);
        }
      };
      svg.append(g);
    }
    root.append(svg);
  }
  function heatmap(view) {
    const root = $("heatmap");
    root.replaceChildren();
    const agents = [...view.index.values()].filter((n) => n.kind === "agent").slice(0, 30),
      roles = [...view.index.values()].filter((n) => n.kind === "role").slice(0, 20);
    if (!agents.length || !roles.length) {
      root.append(el("p", t("noHeat")));
      return;
    }
    const table = el("table"),
      head = el("tr");
    head.append(el("th", t("agent")));
    roles.forEach((r) => head.append(el("th", r.title)));
    table.append(head);
    for (const agent of agents) {
      const row = el("tr");
      row.append(el("th", agent.title));
      const runs = new Set(
        view.edges.filter((e) => e.from === agent.id && e.relation === "runs").map((e) => e.to),
      );
      for (const role of roles) {
        const found = new Set();
        for (const e of view.edges.filter((e) => e.to === role.id && e.relation === "role")) {
          if (runs.has(e.from)) found.add(e.from);
          for (const a of view.edges)
            if (a.relation === "works-on" && a.from === e.from && runs.has(a.to)) found.add(a.to);
        }
        const cell = el("td", String(found.size));
        cell.dataset.hot = String(found.size > 0);
        if (found.size)
          cell.style.backgroundColor = `rgba(63,185,80,${Math.min(0.15 + found.size * 0.12, 0.75)})`;
        row.append(cell);
      }
      table.append(row);
    }
    root.append(table);
  }
  function render() {
    $("status").textContent = busy
      ? t("loading")
      : failed
        ? t("failed")
        : t("status", { state: t("source_" + graph.status), time: graph.observedAt || "—" });
    const view = OperationsModel.view(graph, {
      lens: $("lens").value,
      includeInferred: $("inferred").checked,
      hiddenSessions: privacy,
    });
    $("inference-notice").hidden = !$("inferred").checked;
    $("summary").textContent = t("summary", {
      sources: graph.sources.length,
      runs: view.unlinkedRuns.length,
      suggestions: view.inferredCount,
    });
    const q = $("search").value.toLowerCase(),
      groups = view.groups.filter((g) =>
        [g.seed.title, ...g.tasks.map((n) => n.title), ...g.runs.map((n) => n.title)]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    if (!groups.some((g) => g.seed.id === selected))
      selected =
        (
          groups.find((g) => [g.seed, ...g.tasks, ...g.runs].some((n) => n.id === focused)) ||
          groups[0]
        )?.seed.id || null;
    const root = $("clusters");
    root.replaceChildren();
    if (!groups.length) root.append(el("p", t("empty")));
    for (const g of groups) {
      const button = el("button", undefined, "op-cluster");
      button.setAttribute("aria-pressed", String(g.seed.id === selected));
      button.append(
        el("strong", g.seed.title),
        el("span", t("taskCount", { done: g.done, total: g.tasks.length })),
        el(
          "span",
          t("runCount", { runs: g.runs.length, blocked: g.blockers.length, review: g.review }),
        ),
        el("span", t("suggestionCount", { n: g.suggestions.length })),
      );
      button.onclick = () => {
        selected = g.seed.id;
        focused = g.seed.id;
        render();
      };
      root.append(button);
    }
    const group = groups.find((g) => g.seed.id === selected);
    if (group) inspectNode(view.index.get(focused) || group.seed, view);
    else $("inspector").replaceChildren(el("p", t("select")));
    draw(group, view);
    heatmap(view);
  }
  function init() {
    $("menu").onclick = () => document.getElementById("sidebar")?.classList.toggle("visible");
    for (const id of ["lens", "inferred"]) $(id).onchange = render;
    $("search").oninput = render;
    window.addEventListener("operations:snapshot", (event) => {
      graph = event.detail.graph;
      privacy = event.detail.privacy;
      failed = event.detail.failed;
      render();
    });
    window.addEventListener("i18n:updated", render);
    render();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
