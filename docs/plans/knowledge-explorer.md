# Knowledge explorer v1

Build a read-only, provider-independent three-pane knowledge browser: adapter/topic
hierarchy, filtered documents and source preview. Consume an explicit, bounded
workspace snapshot; never scan provider stores or invoke a retrieval engine in an
HTTP handler. Use a generic contract so Cerebro, files and later QMD can coexist.

Acceptance: identity checks, safe bounded regular-file reads, independent malformed
source handling, explicit snapshot/index timestamps, text-only previews, native
keyboard controls, mobile layout, English/Chinese switching and prefixed routing.
Synthetic preview only until reviewed. No chat, writeback, automatic indexing or
claim that local substring filtering is semantic retrieval.
