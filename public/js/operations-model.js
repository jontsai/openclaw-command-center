(function (root) {
  function view(graph, { lens = "outcome", includeInferred = false, hiddenSessions = [] } = {}) {
    const hidden = new Set(hiddenSessions.map((x) => String(x.id || "").toLowerCase()));
    let nodes = graph.nodes.filter(
      (n) => !(n.kind === "run" && hidden.has(String(n.sessionKey || "").toLowerCase())),
    );
    const visibleRuns = new Set(nodes.filter((n) => n.kind === "run").map((n) => n.id));
    nodes = nodes.filter(
      (n) =>
        n.kind !== "agent" ||
        graph.edges.some((e) => e.relation === "runs" && e.from === n.id && visibleRuns.has(e.to)),
    );
    const index = new Map(nodes.map((n) => [n.id, n]));
    const edges = graph.edges.filter(
      (e) => index.has(e.from) && index.has(e.to) && (e.basis === "observed" || includeInferred),
    );
    function tasksFor(seed) {
      const found = new Set(),
        seen = new Set();
      function expand(k) {
        if (seen.has(k)) return;
        seen.add(k);
        if (index.get(k)?.kind === "task") found.add(k);
        for (const e of edges) if (e.relation === "contains" && e.from === k) expand(e.to);
      }
      if (seed.kind === "outcome") expand(seed.id);
      if (seed.kind === "role" || seed.kind === "topic")
        for (const e of edges)
          if (e.to === seed.id && e.relation === seed.kind) {
            if (index.get(e.from)?.kind === "task") expand(e.from);
            else
              for (const assignment of edges)
                if (assignment.relation === "works-on" && assignment.to === e.from)
                  expand(assignment.from);
          }
      if (seed.kind === "agent") {
        const runs = new Set(
          edges.filter((e) => e.relation === "runs" && e.from === seed.id).map((e) => e.to),
        );
        for (const e of edges) if (e.relation === "works-on" && runs.has(e.to)) expand(e.from);
      }
      return found;
    }
    const groups = nodes
      .filter((n) => n.kind === lens)
      .map((seed) => {
        const ids = tasksFor(seed),
          tasks = [...ids].map((k) => index.get(k));
        const runIds = new Set(
          edges.filter((e) => e.relation === "works-on" && ids.has(e.from)).map((e) => e.to),
        );
        if (seed.kind === "agent") {
          runIds.clear();
          for (const e of edges) if (e.relation === "runs" && e.from === seed.id) runIds.add(e.to);
        }
        if (seed.kind === "role")
          for (const e of edges)
            if (e.relation === "role" && e.to === seed.id && index.get(e.from)?.kind === "run")
              runIds.add(e.from);
        const runs = [...runIds].map((k) => index.get(k));
        const pendingBlockers = edges.filter(
          (e) =>
            e.relation === "blocks" &&
            ids.has(e.to) &&
            !["done", "canceled"].includes(index.get(e.from).state),
        );
        const relevant = new Set([seed.id, ...ids, ...runIds]);
        const suggestions = graph.edges.filter(
          (e) =>
            e.basis === "inferred" &&
            index.has(e.from) &&
            index.has(e.to) &&
            (relevant.has(e.from) || relevant.has(e.to)),
        );
        return {
          seed,
          tasks,
          runs,
          done: tasks.filter((t) => t.state === "done").length,
          review: tasks.filter((t) => t.state === "review").length,
          unknown: tasks.filter((t) => t.state === "unknown").length,
          blockers: pendingBlockers,
          suggestions,
          edges: edges.filter((e) => relevant.has(e.from) && relevant.has(e.to)),
        };
      });
    const assigned = new Set(edges.filter((e) => e.relation === "works-on").map((e) => e.to));
    return {
      groups,
      index,
      edges,
      unlinkedRuns: nodes.filter((n) => n.kind === "run" && !assigned.has(n.id)),
      inferredCount: graph.edges.filter(
        (e) => e.basis === "inferred" && index.has(e.from) && index.has(e.to),
      ).length,
    };
  }
  if (typeof module === "object" && module.exports) module.exports = { view };
  else root.OperationsModel = { view };
})(typeof globalThis === "object" ? globalThis : this);
