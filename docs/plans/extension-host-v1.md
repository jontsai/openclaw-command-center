# Extension host v1 implementation plan

Build a standalone Command Center with optional read-only Spacesuit snapshots.
Preserve the current legacy panels by default for existing installations until
explicit migration. COMMAND_CENTER_MODE=core selects no domain readers;
COMMAND_CENTER_MODE=extensions or workspace selection enables companion snapshots.
Spacesuit is highly recommended but provides no human-agent UX by itself.

## Shared contract

- Selection: <workspace>/state/command-center/extensions.json.
- Shape: {schemaVersion:1,profile:"",agentId:"main",mode:"extensions",enabled:[{id:"spacesuit.intel",version:"1.0.0"}]}.
- mode core: no domain reads; mode legacy: current builtins; absent selection: legacy compatibility.
- profile is OPENCLAW_PROFILE or empty; agentId is OPENCLAW_AGENT or main.
- Snapshot: state/command-center/extensions/<id>.json. Only IDs matching
  ^[a-z][a-z0-9-]_\.[a-z][a-z0-9-]_$ are permitted.
- Snapshot shape: {schemaVersion:1,id,version:"1.0.0",profile:"",agentId:"main",observedAt:ISO8601,status:"ready"|"unavailable"|"error",panels:[]}.
- Host derives stale after 5 minutes; bounded reads, async refresh, per-instance cache;
  stale/error/unavailable never block or become measured zeros. No arbitrary paths/code.
- Panels: {id:"summary",type:"metrics"|"table",title:{en:"...","zh-CN":"..."}, ...}.
- Metrics: metrics:[{label:{en:"...","zh-CN":"..."},value:number|string}].
- Tables: columns:[{key:"name",label:{en:"...","zh-CN":"..."}}], rows:[{name:string|number|null}].
- UI renders strings as text, no links/HTML, and translates using current locale.
- Host output state.extensions = {schemaVersion:1,mode,items:[{id,status,observedAt,panels:[]}],diagnostic?}.
- All diagnostics are fixed safe messages/codes, no raw exceptions/paths.
- IDs namespaces, resource/path bounds, locale integrity, profile/agent matching tested.

## Ownership

Backend agent: src/extensions.js, src/index.js, src/state.js, tests/extensions.test.js,
backend-focused tests and docs for contract if needed. Do not edit public/ or built lib/server.js.
Parent: public UI/locales, source integration review, docs, build, end-to-end tests.
Spacesuit agent: entire Spacesuit feature worktree, packages, CLI and tests; no CC writes.

## Acceptance

Core mode starts without Spacesuit and never calls legacy collectors. Extensions mode
reads selected snapshots only; malformed/missing/wrong-profile data is isolated. Two
profiles and bilingual root/prefixed pages work. Existing legacy regression tests pass.
Spacesuit collect is explicit and snapshot writes atomic; selection preview, backup,
core disable and rollback preserve user data. No live restart, scheduling or deployment.
