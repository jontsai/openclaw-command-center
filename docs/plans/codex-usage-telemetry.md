# Codex quota telemetry repair

## Scope

- Read both current `openai` and legacy `openai-codex` provider snapshots from OpenClaw.
- Keep provider errors independent: Claude failure must not erase OpenAI usage.
- Display the reported quota windows, reset times, and plan, not fixed daily/Plus assumptions.
- Missing, invalid, failed, or stale quota data is unavailable, not zero. A measured zero remains valid.
- Do not infer task counts or token/cost totals from account quota percentages. Do not expose account emails.
- Retain the existing legacy Claude file fallback; unversioned legacy Codex fields are not authoritative quota data.

## Verification

Use synthetic fixtures for modern/legacy providers, independent errors, absent windows, measured zero, invalid percentages, stale snapshots, and safe DOM rendering. Compare the patched adapter with live OpenClaw quota output without capturing account identifiers in public artifacts.

Validated with 202 passing tests, lint (existing warnings only), build, formatting, and repository checks. A focused browser preview passed desktop/mobile layout checks and observed, unavailable, stale, and measured-zero states. The patched adapter matched the upstream reported weekly quota. This does not repair separate transcript token/cost aggregation.
