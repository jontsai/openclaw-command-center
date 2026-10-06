(function () {
  const M = window.OperationsAtlasModel;
  const $ = (id) => document.getElementById("atlas-" + id);
  const t = (key, params = {}) => window.I18N?.t("atlas." + key, params, key) || key;
  const node = (tag, value, cls) => {
    const n = document.createElement(tag);
    if (value !== undefined) n.textContent = value;
    if (cls) n.className = cls;
    n.setAttribute("data-i18n-skip", "");
    return n;
  };
  let raw = [],
    graph = emptyGraph(),
    privacy = { hiddenSessions: [] },
    items = [],
    itemsDirty = true,
    catalog = {},
    total = 0,
    busy = false,
    failed = false,
    lens = "all",
    status = "all",
    trail = [],
    selected = null,
    limit = 60,
    detailEpoch = 0;
  const lenses = ["all", "channel", "agent", "activity", "outcome", "role", "topic"];
  function emptyGraph() {
    return { nodes: [], edges: [], sources: [], status: "unavailable" };
  }
  const name = (s) => s.title || s.channelName || t("session");
  const value = (n) => (n === null ? t("unknown") : n.toLocaleString());
  function button(text, action, pressed) {
    const b = node("button", text, "btn-secondary");
    b.onclick = action;
    if (pressed !== undefined) b.setAttribute("aria-pressed", String(pressed));
    return b;
  }
  function facetName(f, type = lens) {
    if (f.id === "unassigned") return t("unassigned");
    if (type === "activity") return t(f.id);
    return f.title || t("unknown");
  }
  function inspect(s) {
    selected = s.key;
    const epoch = ++detailEpoch,
      box = $("inspector");
    box.replaceChildren(
      node("h3", name(s)),
      node("p", t("sessionMeta", { agent: s.agent || t("unknown"), state: t(s.status) })),
    );
    box.append(
      node("p", t("tokenCount", { n: value(s.tokens) })),
      node("p", t("io", { input: value(s.input), output: value(s.output) })),
      node("p", t("age", { n: value(s.age) })),
    );
    for (const type of ["outcome", "role", "topic"]) {
      box.append(node("h4", t(type)));
      for (const f of s.facets[type]) box.append(node("p", facetName(f, type)));
    }
    if ($("inferred").checked) box.append(node("p", t("inferredNotice")));
    const ids = node("details");
    ids.append(node("summary", t("ids")), node("code", s.key));
    box.append(ids);
    const load = button(t("details"), async () => {
      load.disabled = true;
      detail.textContent = t("loading");
      try {
        const data = await request("api/session?key=" + encodeURIComponent(s.key));
        if (epoch !== detailEpoch) return;
        const overview = data.overview || data;
        // Show bounded text only. Never render transcript HTML or recursively dump arbitrary metadata.
        const summary =
          typeof data.summary === "string"
            ? data.summary
            : typeof overview.summary === "string"
              ? overview.summary
              : "";
        detail.textContent = summary.slice(0, 4000) || t("detailLoaded");
      } catch {
        if (epoch === detailEpoch) detail.textContent = t("detailFailed");
      } finally {
        if (epoch === detailEpoch) load.disabled = false;
      }
    });
    const detail = node("p");
    detail.setAttribute("role", "status");
    box.append(load, detail);
  }
  function render() {
    if (itemsDirty) {
      items = M.build(raw, graph, privacy, $("inferred").checked);
      itemsDirty = false;
    }
    const filtered = M.select(items, {
      query: $("search").value,
      status,
      trail,
      sort: $("sort").value,
    });
    $("status").textContent = busy
      ? t("loading")
      : failed
        ? t("failed")
        : t("coverage", {
            loaded: raw.length,
            total,
            visible: items.length,
            state: t(catalog.status || "unknown"),
            time:
              catalog.observedAt && Number.isFinite(Date.parse(catalog.observedAt))
                ? new Date(catalog.observedAt).toLocaleString(
                    window.I18N?.getLocale?.() || undefined,
                  )
                : t("unknown"),
          });
    document.getElementById("op-refresh").disabled = busy;
    $("summary").textContent = t("matches", { n: filtered.length, all: items.length });
    $("graph-status").textContent =
      t("graphStatus", { state: t(graph.status || "unavailable") }) +
      ($("inferred").checked ? " " + t("inferredNotice") : "");
    $("lenses").replaceChildren(
      ...lenses.map((key) =>
        button(
          t(key === "all" ? "allSessions" : key),
          () => {
            lens = key;
            limit = 60;
            render();
          },
          lens === key,
        ),
      ),
    );
    $("filters").replaceChildren(
      ...["all", "live", "recent", "idle", "unknown"].map((key) =>
        button(
          t(key),
          () => {
            status = key;
            limit = 60;
            render();
          },
          status === key,
        ),
      ),
    );
    $("trail").replaceChildren(
      button(t("everything"), () => {
        trail = [];
        $("search").value = "";
        status = "all";
        limit = 60;
        render();
      }),
    );
    trail.forEach((f, i) =>
      $("trail").append(
        button(t(f.lens) + ": " + facetName(f, f.lens), () => {
          trail = trail.slice(0, i + 1);
          limit = 60;
          render();
        }),
      ),
    );
    if (trail.length)
      $("trail").append(
        button(t("back"), () => {
          trail.pop();
          limit = 60;
          render();
        }),
      );
    const board = $("board");
    board.replaceChildren();
    board.dataset.zoom = $("zoom").value;
    const focused = lens === "all" || trail.some((f) => f.lens === lens);
    const entries = focused ? filtered : M.groups(filtered, lens);
    for (const entry of entries.slice(0, limit)) {
      if (focused) {
        const card = button(
          "",
          () => {
            inspect(entry);
            highlight();
          },
          selected === entry.key,
        );
        card.className = "atlas-session";
        card.dataset.key = entry.key;
        card.append(
          node("strong", name(entry)),
          node("span", t(entry.status)),
          node("span", t("tokenCount", { n: value(entry.tokens) })),
          node("small", entry.model),
        );
        board.append(card);
      } else {
        const card = node("section", undefined, "atlas-stack");
        const open = button("", () => {
          trail.push({ lens, id: entry.id, title: entry.title });
          limit = 60;
          render();
        });
        open.className = "atlas-stack-head";
        open.append(
          node("strong", facetName(entry)),
          node(
            "span",
            t("stackCount", {
              n: entry.items.length,
              live: entry.items.filter((s) => s.status === "live").length,
            }),
          ),
        );
        const account = entry.items[0].account;
        if (lens === "channel") {
          open.append(node("small", entry.hint || ""));
          open.title = [entry.items[0].platform, account, entry.items[0].channel]
            .filter(Boolean)
            .join(" · ");
        }
        card.append(open);
        for (const s of entry.items.slice(0, Number($("zoom").value))) {
          const row = button(
            name(s),
            () => {
              inspect(s);
              highlight();
            },
            selected === s.key,
          );
          row.className = "atlas-peek";
          row.dataset.key = s.key;
          card.append(row);
        }
        board.append(card);
      }
    }
    if (!entries.length) board.append(node("p", t("empty")));
    $("more").hidden = entries.length <= limit;
    $("more").textContent = t("moreCount", {
      shown: Math.min(limit, entries.length),
      total: entries.length,
    });
    // Never retain an inspector for a session removed by filters or privacy.
    const current = filtered.find((s) => s.key === selected);
    if (current) inspect(current);
    else {
      selected = null;
      detailEpoch++;
      $("inspector").replaceChildren(node("p", t("select")));
    }
  }
  function highlight() {
    for (const b of $("board").querySelectorAll("[data-key]"))
      b.setAttribute("aria-pressed", String(b.dataset.key === selected));
  }
  async function request(url) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 15000);
    try {
      const r = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!r.ok) throw Error();
      const reader = r.body.getReader();
      let size = 0;
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 8 * 1024 * 1024) {
          await reader.cancel();
          throw Error();
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let p = 0;
      for (const c of chunks) {
        bytes.set(c, p);
        p += c.length;
      }
      return JSON.parse(new TextDecoder().decode(bytes));
    } finally {
      clearTimeout(timer);
    }
  }
  async function refresh() {
    if (busy) return;
    busy = true;
    render();
    try {
      const settings = await request("api/privacy");
      if (!Array.isArray(settings.hiddenSessions)) throw Error();
      privacy = settings;
      // Graph failures do not take the native session catalog down with them.
      const [s, g] = await Promise.allSettled([
        request("api/sessions?page=1&pageSize=5000"),
        request("api/work-graph"),
      ]);
      graph =
        g.status === "fulfilled" &&
        Array.isArray(g.value.nodes) &&
        g.value.nodes.length <= 2000 &&
        Array.isArray(g.value.edges) &&
        g.value.edges.length <= 5000 &&
        Array.isArray(g.value.sources)
          ? g.value
          : emptyGraph();
      if (
        s.status !== "fulfilled" ||
        !Array.isArray(s.value.sessions) ||
        s.value.sessions.length > 5000
      )
        throw Error();
      raw = s.value.sessions;
      total = s.value.pagination?.total ?? raw.length;
      catalog = s.value.catalog || {};
      failed = false;
    } catch {
      raw = [];
      graph = emptyGraph();
      privacy = { hiddenSessions: [] };
      catalog = {};
      failed = true;
    } finally {
      busy = false;
      itemsDirty = true;
      render();
      window.dispatchEvent(
        new CustomEvent("operations:snapshot", {
          detail: { graph, privacy: privacy.hiddenSessions, failed },
        }),
      );
    }
  }
  function init() {
    for (const id of ["search"])
      $(id).oninput = () => {
        limit = 60;
        render();
      };
    for (const id of ["sort", "inferred"])
      $(id).onchange = () => {
        if (id === "inferred") itemsDirty = true;
        limit = 60;
        render();
      };
    $("zoom").oninput = render;
    $("more").onclick = () => {
      limit += 60;
      render();
    };
    document.getElementById("op-refresh").onclick = refresh;
    for (const [tab, view] of [
      ["atlas", "atlas"],
      ["work", "work"],
    ])
      document.getElementById(tab + "-tab").onclick = () => {
        for (const type of ["atlas", "work"]) {
          document.getElementById(type + "-view").hidden = type !== view;
          document
            .getElementById(type + "-tab")
            .setAttribute("aria-pressed", String(type === view));
        }
      };
    window.addEventListener("i18n:updated", render);
    refresh();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
