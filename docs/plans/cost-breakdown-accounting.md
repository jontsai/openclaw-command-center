# Cost and detail reliability

- Share live-update streams across components and supported same-origin tabs; avoid exhausting browser HTTP connection slots.
- Serve session details from cached session metadata, coalesce async cold refresh and history loads, and avoid synchronous CLI calls on the detail route.
- Read modern model-aware usage.cost reports asynchronously with a bounded cache; retain legacy JSONL fallback without confusing unavailable readings with zero.
- Label calendar-day reporting explicitly and distinguish API-equivalent cost from subscription billing; remove hardcoded mixed-model Opus prices and assumed savings.
- Add loading/error/cancellation handling to the cost panel and stale-response protection to detail requests.
- Verify root/prefixed routes, multi-tab latency, missing/stale/partial data and synthetic accounting fixtures. Publish for review; no live activation.

- Review correction: preserve localization hooks, separate translated labels from runtime values, add supported-locale cost text, and verify English/Chinese switching while the cost panel is open and after updates.
