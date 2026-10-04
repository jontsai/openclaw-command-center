# Explicit session-store compatibility

## Goal

Restore session listing on OpenClaw installations with multiple configured agents.
The dashboard already reads transcripts from `agents/main/sessions`; its CLI
queries must select that same owner rather than relying on an implicit default.

## Acceptance

- All dashboard session-list consumers select `main` explicitly, without
  aggregating other agents or changing the selected OpenClaw profile.
- Request the complete list so the CLI's default limit does not truncate totals
  or make older session details disappear.
- Both CLI execution paths accept larger catalogs with a bounded output buffer.
- Regression tests cover synchronous/asynchronous listing, more than 100
  sessions, detail lookup beyond the default page and output above 1 MiB.
- Rebuild the shipped server; run tests, lint and repository checks.

## Scope

Update `src/openclaw.js`, session-list callers in `src/sessions.js`,
`src/state.js`, `src/actions.js`, regression tests and `lib/server.js`.
Do not change gateway processes, authentication, deployment settings or the
existing main-agent-only transcript model. No release or live activation.

## Compatibility

Requires the session CLI options `--agent` and `--limit all`. See the
[OpenClaw sessions reference](https://docs.openclaw.ai/cli/sessions).
Keep existing caching/performance fixes in separate PRs.
