# Prefixed dashboard requests

Fix session detail and other API calls escaping the dashboard path under a reverse proxy. Use document-relative API, event-stream, partial and locale URLs on dashboard and jobs pages. Verify root and prefixed paths, encoded session keys and pagination. Preserve session metadata when transcripts are absent and label transcript-derived sections unavailable rather than claiming no activity. This does not add a modern transcript-storage adapter or alter proxy configuration.

Validation: 206 tests pass; lint has no errors (existing warnings only); build, formatting and repository checks pass. Browser exercise covers root and prefixed mounts, session details, page-two retrieval, job run/pause/resume/history URLs using intercepted synthetic responses, and sidebar round-trip navigation. No real job mutations or deployment performed.
