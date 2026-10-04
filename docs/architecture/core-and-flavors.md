# Core monitoring and Spacesuit flavors

Status: read-only host v1 implemented; final legacy removal remains planned.
See [extension API v1](extension-api-v1.md) for the executable contract and current limits.

## Decision

Command Center owns reusable OpenClaw monitoring and the generic extension host.
OpenClaw Spacesuit owns agent flavors: optional domain workflows, data collectors,
panel definitions, translations, and workspace conventions. A flavor composes
extensions; it is not a fork of Command Center or a separate OpenClaw runtime.

Command Center works standalone. Spacesuit is its highly recommended companion;
it can scaffold/collect independently but has no graphical human–agent interaction
surface without Command Center. Installing either package must not implicitly
start the other or imply that a chat composer exists.

## Why this boundary

The current `src/index.js` creates Intel, Pipeline, and Monetization modules and
passes their collectors into `src/state.js`. Legacy-mode state refreshes invoke all
three, even though their `intel/` files and business semantics are not universal
OpenClaw capabilities. Hiding the panels alone would leave this coupling intact.

A separate dashboard fork per agent would multiply compatibility, security, and
localization fixes. Putting all domain behavior in core instead makes every
installation carry unrelated assumptions. A shared core with optional Spacesuit
extensions avoids both outcomes.

## Ownership map

| Capability                                                                                    | Owner / destination                                   |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Gateway connectivity, version and health; host vitals                                         | Command Center core                                   |
| Sessions, subagents, session details and recent messages                                      | Command Center core                                   |
| Token/cost accounting, quota windows, freshness and unavailable states                        | Command Center core                                   |
| OpenClaw cron/jobs status and existing authorized controls                                    | Command Center core                                   |
| Generic memory/storage health, identity and channel metadata                                  | Command Center core                                   |
| Routing prefixes, authentication, privacy/redaction, shared transport, UI primitives and i18n | Command Center core                                   |
| Intel file conventions and freshness rules (`src/intel.js`)                                   | Spacesuit extension, first extraction candidate       |
| Domain pipeline/queue table parsing (`src/pipeline.js`)                                       | Spacesuit extension, first extraction candidate       |
| Firm/revenue/priority logic (`src/monetization.js`)                                           | Spacesuit extension, first extraction candidate       |
| Cerebro taxonomy, custom summaries and workspace-specific workflows                           | Assess for Spacesuit extraction after the first three |
| Agent-specific panels, labels, defaults, runbooks and reusable workflows                      | Spacesuit flavor                                      |
| Actual business data, credentials and per-installation identity/settings                      | Private workspace; never the public flavor package    |

Session overview, summary, references, attention, facts, tools and messages remain
core where derived generically from OpenClaw session data. A specialized business
interpretation can add a namespaced extension panel; it must not replace the core
session endpoint or make it depend on a flavor. Existing session-detail errors are
reliability bugs, not justification for moving session monitoring into Spacesuit.

## Original design and implemented v1 contract

Command Center owns the versioned selection and normalized snapshot contract.
Spacesuit owns its package manifests and authors snapshots against that contract.
[Extension API v1](extension-api-v1.md) establishes the actual paths, environment
mode, inline bilingual labels, validation limits and compatibility behavior.
The following requirements remain the direction for further migration.

Required concepts:

- Stable namespaced extension ID, package version, contract major version, and
  compatible core version range; reject duplicate IDs or incompatible contracts.
- An explicit per-instance allowlist of enabled extensions. Bind it to the selected
  OpenClaw profile, agent and workspace; never infer flavor from a machine name.
- Declared panel IDs, supported core renderer types and namespaced translation keys.
- Typed data with `status`, `observedAt`, and bounded diagnostic information.
  Distinguish loading, ready, stale, unavailable, error and disabled; zero requires
  an actual measured zero. Do not export secrets or raw exception internals.
- Workspace-relative, validated data inputs. Do not let a flavor choose another
  profile, traverse outside allowed roots, or override core routes/authentication.

Start with read-only, declarative cards/tables rendered by core. Flavor-owned
collectors run outside the monitoring request path and publish bounded snapshots.
Validate snapshots before rendering and use core escaping/redaction. No arbitrary
HTML, remote scripts, shell commands, or dynamic `require()` from a manifest in v1.
Executable collectors remain installed code requiring review; the manifest is not
a sandbox and does not grant permissions or schedule jobs.

Each collector has an independent timeout, size limit, cache and refresh budget.
An extension failure must not delay `/api/state`, `/api/session`, or other extensions.
Use the shared state/transport abstraction; no SSE connection per panel or new
connection per tab. Do not add one network request per session-detail section.

Preserve `data-i18n` hooks and existing translation keys; localize dynamic, empty,
stale and error states too. Switching languages while an extension is open must
work. Use document-relative routing so root and reverse-proxy prefixes both work.

## Migration sequence

1. Completed: land the ownership documentation in both repositories independently of cost,
   session-detail and localization fixes. The documentation-only change altered no runtime behavior.
2. Implemented in v1: a versioned, validated read-only extension host with synthetic data;
   prove core-only mode. Add independent cached snapshot reads, not synchronous
   domain collectors to the core request path.
3. Move Intel, Pipeline and Monetization implementations, tests, panel definitions
   and locales into reusable Spacesuit extensions. Preserve contributor attribution
   and license notices. Leave generic primitives in Command Center.
4. Add flavor composition and preview/diff/backup support in Spacesuit. Select
   flavors explicitly for each agent; two profiles on one host can choose different
   flavors without changing the shared Command Center checkout.
5. Pilot one instance, then a second with a different flavor. Compare core data,
   latency and isolation before a sequential fleet rollout.
6. Remove core's legacy domain collectors only after feature parity, a documented
   compatibility window and an explicit migration choice for existing users.

The initial host retains legacy mode by default for compatibility; explicit core
mode is fully standalone. A default change for fresh installations is deferred
until a reliable migration distinction exists.
Existing installations must retain legacy panels during migration or explicitly
opt into the new configuration; do not silently remove panels or infer selection
from the mere presence of files. Disabling a flavor stops its collection/rendering
but preserves data. Rollback restores the previous package/configuration pair;
removal of an extension must never delete workspace artifacts.

## Acceptance gates for implementation

- Core-only startup without Spacesuit, domain directories or flavor configuration.
- Two profiles with different flavor selections and no cross-profile data/cache leaks.
- Disabled collectors perform no reads; malformed/slow/missing snapshots cannot stall core.
- Root and prefixed routing; shared live stream with multiple panels and tabs.
- English/Chinese switching through loading, ready, stale, empty and error states.
- Existing injection and blank-cell regression coverage follows extracted modules.
- Existing users retain panels/data; preview, upgrade and rollback preserve overrides.
- Session/cost reliability changes remain independently reviewable and deployable.

See the companion [Spacesuit flavor design](https://github.com/jontsai/openclaw-spacesuit/blob/main/docs/architecture/agent-flavors.md)
when merged. Cross-repository links are design references, not installation dependencies.
