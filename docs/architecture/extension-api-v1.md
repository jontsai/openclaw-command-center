# Read-only companion extension API v1

Command Center runs standalone. Spacesuit is its **highly recommended companion**
for agent flavors and domain workflows. Spacesuit scaffolding and collectors can
run on their own, but Spacesuit does **not** provide a graphical human–agent
interaction surface: use Command Center for the dashboard and supported controls.
Neither package adds a new chat composer through this extension API.

## Modes and compatibility

| Selection                                     | Behavior                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| `COMMAND_CENTER_MODE=core`                    | Core monitoring only; zero extension or legacy domain reads                |
| `COMMAND_CENTER_MODE=legacy`                  | Existing built-in Intel/Pipeline/Monetization panels; zero extension reads |
| Workspace selection with `mode: "extensions"` | Validated snapshots; legacy collectors disabled                            |
| `COMMAND_CENTER_MODE=extensions`              | Requires valid workspace selection; fails closed without it                |
| No environment override and no selection file | Legacy compatibility mode; Spacesuit not required                          |
| Invalid mode/selection or wrong identity      | Core monitoring plus a safe diagnostic; no domain fallback                 |

This first release preserves existing built-ins by default rather than silently
removing them. A fresh install already works without Spacesuit; choose explicit
`core` mode for a minimal dashboard. Full removal of the compatibility modules is
future migration work, not part of v1.

```bash
# Run from the Command Center checkout, with normal OpenClaw workspace discovery:
COMMAND_CENTER_MODE=core npm start
```

The optional selection file is `state/command-center/extensions.json`, under the
selected workspace. Environment mode takes precedence. Profile is `OPENCLAW_PROFILE`
(or empty), agent binding is `OPENCLAW_AGENT` (or `main`). Generic monitoring still
uses this release's existing main-agent session adapter; setting OPENCLAW_AGENT
binds extensions, not a newly implemented arbitrary-agent monitoring feature.
Use a separate workspace for each profile/agent selection; sharing this selection
file across different identities is deliberately rejected.

```json
{
  "schemaVersion": 1,
  "profile": "",
  "agentId": "main",
  "mode": "extensions",
  "enabled": [{ "id": "spacesuit.intel", "version": "1.0.0" }]
}
```

IDs match `^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$`. Version pins must match exactly.
Duplicate IDs, unknown schema versions and identity mismatches fail closed. No
manifest may specify an executable, route, URL, or data path for the host to load.

## Snapshot and panel format

Each selected snapshot lives at
`state/command-center/extensions/<id>.json`. Spacesuit's reviewed collector writes
it atomically; Command Center never runs collectors in a request or schedules them.

```json
{
  "schemaVersion": 1,
  "id": "spacesuit.intel",
  "version": "1.0.0",
  "profile": "",
  "agentId": "main",
  "observedAt": "2026-01-01T00:00:00Z",
  "status": "ready",
  "panels": [
    {
      "id": "summary",
      "type": "metrics",
      "title": { "en": "Research", "zh-CN": "研究" },
      "metrics": [{ "label": { "en": "Files", "zh-CN": "文件" }, "value": 3 }]
    }
  ]
}
```

- Producer status: `ready`, `unavailable`, or `error`. Host derives `stale` after
  five minutes. Missing files become unavailable; invalid files become error.
- `metrics` contains localized label/value pairs; values are finite numbers or strings.
- `table` contains `columns: [{key, label}]` and `rows: [{<key>: value}]`.
  Every declared cell must be a finite number, string or explicit null.
- All titles/labels carry nonempty `en` and `zh-CN` values. Panel/column IDs are
  unique safe keys. The host strips unrecognized fields rather than exposing them.
- v1 uses namespaced extension/panel IDs and bilingual labels embedded in each
  snapshot. No locale-file fetching or translation registration is needed at runtime.
- Data values are rendered as text, never HTML, links or executable attributes.
  Business values are excluded from heuristic phrase translation. Both labels and
  status messages switch language while the panel is open.

## Bounds and failure isolation

Selections: 16 KiB and 8 extensions. Each snapshot: 256 KiB, 8 panels, 24 metrics,
12 columns, 100 rows/table, 2,048 characters/value and 256 characters/label.
Oversized or invalid snapshots are rejected, not silently rendered in part.
Symlinks, nonregular files and paths outside the workspace are rejected.

Reads refresh asynchronously every five seconds on access and are coalesced.
Selection and individual snapshot reads have bounded waits; a failed or stalled
snapshot does not suppress healthy siblings. Pending disk reads are capped so a
stalled filesystem cannot accumulate work. `/api/state` returns cached normalized
`extensions: {schemaVersion, mode, items, diagnostic?}` through the existing state
and live-update paths. There are no extension-specific browser requests or streams.

Core monitoring does not await snapshot refreshes. Diagnostics contain fixed codes,
not raw exceptions or private paths. Missing/stale data never becomes a false zero.
Core/legacy explicit modes perform no selection/snapshot reads at all.

## Privacy and trust

Only enable reviewed producers and approved data sources. Snapshots are display-ready
data, **not a place for credentials**. Host and companion collectors apply common
credential-pattern redaction as defense in depth; this is not a comprehensive
secret detector or a substitute for selecting appropriate data. Snapshot contents
are visible to users authorized to access the dashboard. Existing hostname/session
privacy toggles do not hide arbitrary business fields in extension tables.

The existing dashboard authentication boundary applies. This API adds no permission
or public access. Installing a package or selecting a flavor does not authorize
network calls, writes to other profiles, scheduled collection or deployment.

## Companion activation and rollback

Use the Spacesuit flavor CLI to preview, apply and collect. See the companion
README for exact commands. Keep COMMAND_CENTER_MODE unset when using workspace
selection. Applying a flavor changes only that workspace's selection; it does not
start Command Center or collectors. Collection is an explicit separate operation.
Disabling selects core mode while retaining data/snapshots; restore recovers the
previous selection from a backup. Review package versions together before upgrading.
