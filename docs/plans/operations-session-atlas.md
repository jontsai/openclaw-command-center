# Browse-first operations atlas

Goal: open Operations with all visible runtime sessions, independent of tracker setup.

Acceptance: overview stacks by scoped channel/agent/activity or exact graph relationships;
filters and breadcrumbs compose; unassigned work retained; zoom changes density;
progressively render large groups without pretending the visible page is complete;
privacy failure clears data; stale/partial coverage labeled; IDs secondary;
English/Chinese, mobile and prefixed routes work. No inferred project identity by title.

Implementation: add a pure atlas model and browser controller alongside the existing
work graph, reuse cached session API with freshness metadata, add fixture tests and
a pinned-source pilot guide. The graph remains an optional evidence layer.

Validation: model tests for duplicate/account isolation, unmatched runs, privacy,
inferred links and unknown metrics; browser interactions and full repo checks.
No automatic tracker connection, new registry release, merge or deployment.
