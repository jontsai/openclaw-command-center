# Project snapshots API

`GET /api/projects` returns the selected workspace's read-only project portfolio.
It uses the dashboard's existing authentication and profile/agent scope. Call the
relative `api/projects` URL when the dashboard is mounted behind a path prefix.

The response is a versioned object with `schemaVersion: 1`, aggregate `status`,
and `sources`. Each source preserves its ID, provider, label, observation time,
source status and normalized projects. See [the contract](../plans/project-portfolio-v1.md)
for field shapes and limits and [the architecture](../architecture/project-portfolio.md)
for ownership and interpretation.

A successful read returns HTTP 200 even when a selected source is stale, malformed
or unavailable: inspect the aggregate and individual source statuses. An absent
selection returns `status: unavailable` and an empty source list; an invalid shared
selection returns `status: error`. Diagnostics are stable categories, never raw
provider exceptions or filesystem paths. Valid retained observations are marked
stale on source failure, including after a host restart; their timestamps are not
advanced to make them appear current.

Other methods return HTTP 405 with `Allow: GET`. Responses use `Cache-Control:
no-store`. Reads are bounded and coalesced; requesting this endpoint does not call
Linear/Jira or run a collector. Core monitoring does not depend on this endpoint.
Clients should fetch on entry or explicit refresh, not per project or via additional
live streams. Snapshot refresh does not mean tracker synchronization.
