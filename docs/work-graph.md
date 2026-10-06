# Operations map: work graph v1

`operations.html` is a read-only map with outcome/epic, role, agent, and topic lenses.
The same task/run identities connect these views. Select a node to inspect its
relationships and their evidence. Identifiers are collapsed by default.

## Snapshot contract

`GET /api/work-graph` reads `state/command-center/work-graph.json` under the configured
workspace. Missing, unsafe, malformed, or wrong-profile files return an unavailable
state with no graph content. No provider credentials or network collection run in
the browser. Existing dashboard access controls apply; this is not a public feed.

The Spacesuit `scripts/work-graph.js` compiler can produce this format from reviewed
Linear/Jira exports and explicit agent-run records. It is optional: any collector
may implement the contract. Compilation and serving are independent of installation.
No live tracker sync or scheduler is enabled by this change.

Top-level fields: `schemaVersion: 1`, `profile`, `agentId`, `observedAt`, `sources`,
`nodes`, `edges`, `warnings`. Source IDs identify the source organization/account,
not just its provider. Each source declares `id`, `provider`, `observedAt`, and
`complete`. Partial exports must declare `complete: false`.

Nodes have `id`, `sourceId`, `kind`, `title`, `state`, `nativeStatus`, and `observedAt`.
Optional `nativeId`, `identifier`, `sessionKey`, and `agent` support inspection.
Kinds: `outcome`, `task`, `run`, `agent`, `role`, `topic`. IDs must be unique; native
IDs alone are not global identity. Auxiliary agent/role nodes may use a shared scope.
Collectors must namespace agent identity by runtime/account when aggregating hosts.

Edges have `from`, `to`, `relation`, `basis`, and `evidence`. Relations:

- `contains`: outcome/task → task, observed only; cycles rejected.
- `works-on`: task → run, observed or inferred.
- `runs`: agent → run, observed only.
- `role`: task/run → role, observed or inferred.
- `topic`: task → topic, observed or inferred.
- `blocks`: task → task, observed only.

Task containment, assignments, topics, and blockers cannot cross source scopes.
Cross-provider identity reconciliation is not implemented. An observed binding is
an assertion supplied by the collector, not independent proof that it is correct.

## Meaning and limitations

- Default groups/counts use observed links. The inference toggle previews candidate
  links, is visibly marked, and never accepts or persists a suggestion.
- Tracker Done counts are distinct imported tasks, including parent tasks. They are
  not weighted completion, acceptance evidence, or an estimate of remaining effort.
- A finished run is not automatically a completed task.
- Blockers are imported blocking links whose predecessor is not Done/Canceled;
  missing dependency coverage may conceal other blockers.
- Heatmap cells count distinct linked runs, not busy time or available capacity.
  Roles are assignments for work, not permanent capabilities of an agent.
- Topic labels are explicit taxonomy, not semantic embedding clustering.
- Source observations older than five minutes are stale. Loading a page does not
  refresh source evidence. Partial exports and missing references remain visible.
- Updates are manual snapshots. ETA, schedule variance, resource reallocation,
  token-rate overlays, proposal acceptance, and live synchronization are not built.

Bounds: 2 MiB snapshot, eight sources, 2,000 nodes, 5,000 edges. Selected diagrams
show at most 40 nodes; heatmaps at most 30 agents × 20 roles. Group totals cover the
validated snapshot, not the entire fleet. Hidden-session settings are loaded first;
hidden runs, their edges, and orphan agent nodes are excluded. Privacy-fetch failure
clears the view. It does not hide independent tracker objects merely because one
of their associated sessions is hidden.

`tests/fixtures/work-graph.json` is fully synthetic. Its old timestamps intentionally
show stale data; do not replace it with real workspace exports or screenshots.

## Browse-first session atlas

Operations now opens on **All sessions**, loaded from the same cached native
catalog as System Vitals. It does not need a tracker export or a known search term.
Group chips build channel, agent, activity-window, outcome, role or topic stacks.
Open a stack, regroup the subset, and use breadcrumbs/Back/Everything to navigate.
Zoom changes card density/detail; this is a browseable atlas, not a free-pan canvas
or automatic semantic-clustering engine. The existing work graph remains available
under **Work relationships**.

The catalog request loads at most 5,000 sessions and 8 MiB; the view reports loaded,
source-total, privacy-visible and filtered counts separately. Cards and stacks are
rendered in batches of 60 with Show more. Nothing outside the displayed coverage is
claimed to be searched. Catalog observation time is distinct from tracker freshness.
Refresh reuses the cached native catalog; it does not synchronously rescan transcripts.

Outcome/role/topic associations require exact run `sessionKey` matches to the
validated work graph. Titles never create bindings. Sessions without bindings stay
in **Unassigned**, and inference is opt-in and unsaved. Token fields remain unknown
when absent and are labeled lifetime totals. Activity and tokens are not completion.
The summary fetch is on demand, relative to the dashboard path, bounded and abortable;
a failed detail request does not clear the session metadata.

No additional SSE connection, tracker sync or auto-refresh schedule is introduced.
Privacy settings load before catalogs; a privacy error clears both views. Hidden
sessions are omitted before all grouping/filtering/inspection. See the
[source-build pilot guide](operations-source-pilot.md) for isolated testing without
a registry release.
