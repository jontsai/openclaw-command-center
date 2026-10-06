# Session explorer

## Goal

Readable, read-only investigation of session metadata through search, combined filters, explicit groups, and an inspector. This is not a semantic graph or execution control.

## Acceptance

- Search a bounded snapshot of up to 1,000 sessions; show loaded coverage and fetch time, not implied fleet completeness.
- Group by scoped channel identity, agent, platform, session kind, or last-activity window; never join by display name alone.
- Apply hidden-session settings before search/group/display; fail closed if privacy settings cannot load.
- Preserve unknown metadata; no claims of parentage or inferred topics.
- Text-only rendering, English/Chinese localization, keyboard-accessible controls, responsive layout, prefix routing.
- No writes, credentials, background indexing, new dependencies, or runtime changes.

## Implementation

1. Pure browser/Node query and grouping module with unit tests.
2. Separate sessions.html with group rail, result list and inspector; shared navigation.
3. Synthetic bounded preview; browser and full repository checks.

## Files

public/sessions.html, public/js/session-explorer\*.js, public/css/session-explorer.css, shared sidebar/locales, README, tests/session-explorer.test.js.

## Tests

Account/provider isolation, unknowns, conjunctive filters, literal search, privacy, sorting, bounded fetch/failure, safe rendering, root/prefixed URLs, desktop/mobile, locale changes and refresh.
