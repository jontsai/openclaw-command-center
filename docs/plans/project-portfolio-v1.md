# Project portfolio v1 implementation plan

## Goal and ownership

Command Center owns a reusable read-only project board. Spacesuit owns tracker adapters,
status mappings and private per-installation bindings. Trackers remain authoritative.
Projects/outcomes are not tasks or runtime sessions. Linear projects and Jira epics are
the initial outcome mapping; preserve kind and allow explicit mapping. Jira containers
must not be silently presented as delivery outcomes. Asana/GitHub adapters are future
implementations of the same contract, not claimed supported by v1.

Memory/knowledge/topic adapters are independently composable from tracker adapters and
flavors. Reuse OpenClaw-native retrieval; do not hardcode Cerebro layout into core. A later
bounded query contract is needed for interactive search; this snapshot API is not that.

## Shared contract (v1)

- Selection: state/command-center/project-sources.json under chosen workspace.
- {schemaVersion:1,profile:"",agentId:"main",sources:[{id:"linear-main",provider:"linear",label:"Example",enabled:true}]}.
- IDs /^[a-z][a-z0-9-]{0,63}$/; max 8 sources. Disabled means no snapshot reads.
- Snapshot: state/command-center/projects/<sourceId>.json.
- {schemaVersion:1,sourceId,provider,profile,agentId,observedAt:ISO8601,status:"ready"|"partial"|"error"|"unavailable",projects:[]}.
- Max 1 MiB/snapshot, 200 projects/source, 8 sources, 5-minute staleness; no remote I/O in host.
- Project: {id:string,title:string,url:https URL|null,kind:"project"|"epic"|"milestone",stage:"inbox"|"planned"|"doing"|"review"|"done"|"canceled"|"unknown",nativeStatus:string,nativeStatusId?:string|null,health:"on-track"|"at-risk"|"blocked"|"off-track"|"unknown",owner:string|null,summary:string,updatedAt:ISO8601|null,targetDate:YYYY-MM-DD|null,counts:{total:number|null,done:number|null,blocked:number|null},agents:string[],sessionKeys:string[],dependencies:[{sourceId,projectId}]}.
- id max 128, title/owner/nativeStatus max 256, summary max2048; agents/sessionKeys/dependencies max20; missing metrics null, never fabricated zeros.
- counts nonnegative integers, done/blocked cannot exceed known total. Counts describe underlying tasks, NOT project completion or weighted progress. No inferred associations by title; explicit links only.
- Composite identity = sourceId + project id (structured pair); NEVER dedupe by title.
- snapshot provider/source/profile/agent must match selection. Invalid items isolate their source.
- HTTP output: {schemaVersion:1,status:"ready"|"partial"|"unavailable"|"error",sources:[{id,provider,label,status,observedAt,projects:[]}]}.
- Host may emit loading,disabled,stale on sources. Missing selection is unavailable, not an error in core monitoring. No raw exceptions/paths. Keep last-known valid data marked stale on subsequent failure, if feasible, never present fresh.
- No external mutation controls or drag/drop. Writes/transition permissions are a later explicit capability.

## Implementation ownership

Backend agent: src/projects.js and tests/projects.test.js only. Export createProjectHost({workspace,profile,agentId,now,readJson,timeoutMs,refreshMs}) with sync getState(), async refresh(); expose validateProjectSnapshot if useful. Use bounded symlink/FIFO-safe reads, per-file coalesced independent timeout. Do not edit shared state/index/build/locales.
UI agent: public/projects.html, public/js/projects.js, public/css/projects.css, tests/projects-ui.test.js only. Plain JS/CSS matching existing design. One bounded relative api/projects request on initial load + explicit refresh (not per-card), no new SSE/poll loops. Sidebar can retain shared stream. Render identity/provider/native status/freshness/health/counts/explicit agents/dependencies, filters/search, localized columns/empty/error states. No HTML interpolation from data, no credentials or hidden protocol controls.
Parent: source wiring /api/projects, navigation, en+zh-CN locales, docs, merge reliability/i18n, browser preview/integration/build/publish.
Spacesuit agent: own separate repo worktree; lib/projects modules, scripts/projects.js, tests/project\*.js/shell runner, docs. Normalize authentic Linear/Jira payload shapes with injected read-only API clients and pagination/timeout/limit correctness. Import CLI preview/apply from explicit local provider exports; no plaintext credential handling or live tracker config. Status maps keyed by native IDs/semantic categories with unknown fallback; never guess review from Jira done. Document no live sync configured; provide host-injected request interface instead of collecting secrets. Preserve base/templates/SKILL.

## Acceptance

Mixed Linear/Jira projects correctly grouped, same title across providers retained, missing metrics remain unknown, unmapped/review/canceled separate; offline source isolated and freshness honest. Two profiles reject each other's data; bounded imports/safe writes/explicit selection; prefix/root routing; EN/ZH switch after refresh; HTML/unsafe link rejection; core-only absence remains functional; no extra streams or real tracker mutations; existing tests remain green.

Synthetic preview first, then real source pilot only after configured authorized access.
