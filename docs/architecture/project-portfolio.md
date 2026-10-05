# Project portfolio and tracker adapters

## Ownership

Command Center provides a unified project board and generic snapshot validation.
Spacesuit provides reusable tracker adapters, status mappings, collection, and
optional workflows. Tracker workspaces remain systems of record; no bidirectional
sync, status transitions, or credentials are added to the dashboard.

A project is a delivery outcome, not a task, session, or every tracker container.
The initial adapters use Linear projects and Jira epics. The contract preserves the
native entity kind; explicitly configured mappings may choose a different grain.
Do not silently equate a Jira container with a delivery project.

## Independent dimensions

- Workflow: Inbox, Planned, Doing, In Review, Done, Canceled, or Unknown.
- Health: on track, at risk, blocked, off track, or unknown. Blocked is not Done.
- Execution: explicitly linked agents and session references, not inferred by title.
- Source quality: ready, partial, unavailable/error, disabled, or stale observations.

Native status remains visible next to its mapped stage. Unknown mappings never
become Doing or Done automatically. Review requires an explicit native status map
when the provider has no review category. Missing task counts stay null; a task
completion fraction is not a weighted project-completion estimate.

Each identity is a structured pair of source ID and native project ID. Two sources
with identical titles remain distinct. Cross-tracker reconciliation, dependencies,
and agent/session associations require explicit bindings, not fuzzy title matching.

## Read-only v1

`projects.html` consumes the bounded, authenticated `GET api/projects` view. It
fetches once on load and on explicit refresh; no per-card requests or additional
live stream is opened. Existing shared navigation retains its shared transport.
The core state/session/cost path performs no project collector or network work.
All paths remain document-relative for reverse-proxy mounts.

A workspace selects up to eight sources in
`state/command-center/project-sources.json`. Each enabled source supplies a
versioned, profile/agent-bound snapshot at
`state/command-center/projects/<sourceId>.json`. See the exact shapes and bounds
in [the implementation plan](../plans/project-portfolio-v1.md).

No sources is an honest setup/empty state, not a failure of standalone monitoring.
Bad sources are isolated. All imported strings are treated as text; source links
must use safe HTTPS URLs. Credentials, raw exceptions, private paths, and arbitrary
executable manifests do not belong in snapshots.

Spacesuit's initial local-export import and injected-client collector interface
are testable without credentials. Installing these changes does **not** configure
live Linear/Jira synchronization. A live pilot needs a host-owned authenticated
read-only transport and explicit source/entity selection. Asana and GitHub Issues
are planned adapters, not implemented integrations in this slice.

## Memory, knowledge, and topics

Memory strategies and tracker adapters are separately composable capabilities,
not mutually exclusive agent flavors. Spacesuit owns file conventions, topic
classification, provider-specific adapters, curation and retrieval policies.
Command Center owns provider-independent presentation, source citations and health.
Reuse OpenClaw's native retrieval where available; do not duplicate its runtime.
The Cerebro filesystem layout is a candidate Spacesuit adapter, not a universal
knowledge model. Interactive search requires a future bounded query capability,
not searches in monitoring refreshes or this read-only snapshot protocol.

## Next slices (not shipped)

1. Authorized live Linear/Jira source pilots; complete paging and honest sync health.
2. Project details joining source-linked tasks, reviews, evidence, and agent runs.
3. Dependency/risk views, ownership and capacity, waiting-on-human queues and aging.
4. Capability-gated tracker writes with per-tracker allowed transitions, optimistic
   concurrency, an audit trail and explicit user authorization. No fake drag/drop.
5. Additional tracker adapters and independent knowledge query adapters.

Validate root/prefix routing, multilingual open-panel refresh, resource limits,
profile isolation, stale/partial/offline data and standalone no-source behavior.
