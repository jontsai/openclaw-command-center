# Knowledge explorer v1

The read-only `knowledge.html` view displays adapter-supplied hierarchy, document
excerpts and provenance. It does not invoke QMD, scan memory directories, infer
topic relationships or execute retrieved instructions. Provider interpretation
belongs to Spacesuit; this host is provider-independent.

## Contract

`GET api/knowledge` reads the fixed workspace-relative file
`state/command-center/knowledge.json` under the existing server authentication.
Other methods return 405. There are no file-path parameters or provider URLs.

Root fields: `schemaVersion: 1`, `profile`, `agentId`, `sources` (at most 8).
Every source supplies `id`, `label`, `adapter`, `status` (ready/partial/error/unavailable),
`observedAt`, nullable `indexUpdatedAt`, and `documents` (at most 500).
Every document supplies `id`, nullable `parentId`, `kind` (folder/topic/document),
`title`, `sourceRef`, `excerpt`, nullable `updatedAt`, `truncated` and nullable `url`.
The synthetic fixture in `tests/fixtures/knowledge.json` is an executable example.

Parent references stay within their source; missing parents/cycles/depth over 20
reject that source independently. Identity mismatch rejects the whole snapshot.
Read size is bounded to 2 MiB; files must be regular and have no symlink ancestors.
Source labels and document text are redacted by the existing display redactor;
raw unknown fields are stripped. URLs require HTTPS without credentials/query/hash.
The renderer uses text nodes, never provider HTML or Markdown execution.

Reads are coalesced and cached for five seconds, with a two-second response deadline
and at most one outstanding file read. A missing/invalid snapshot clears the view;
the host does not silently retain content after an identity error or disable/removal.
This endpoint is separate from monitoring refreshes; there is no additional SSE feed.

## Truthful freshness and capabilities

`observedAt` means snapshot collection time, not index freshness. `indexUpdatedAt`
means the adapter's reported source/index update; file adapters use latest included
file mtime, which is not proof a semantic index exists. The UI labels it “Latest
source update.” Unknown timestamps remain unknown. Fifteen minutes without a new
observation marks the snapshot stale, including while the view stays open.

Search currently filters loaded titles, references and excerpts locally. It is
not full-text corpus search, vector similarity or QMD retrieval. Previews are capped
at 12,000 characters and truncation is explicit. Spacesuit now supplies opt-in QMD
collection snapshots using the same hierarchy contract, with QMD citations rendered
as inert source references. Its bounded sample is not a full index export. QMD
source/index modification times are unknown when the CLI does not supply them.
Interactive retrieval still requires a separate bounded query API. Do not represent a fresh collection of old files as newly learned knowledge.

## Preview and verification

Run `node scripts/preview-knowledge.js` for synthetic data on loopback port 18340
(override PORT if needed). It serves only public assets and the synthetic fixture;
it never loads workspace configuration or real memories. Both `/knowledge.html`
and `/preview/knowledge.html` work. The preview banner remains explicit.

Optional browser verification: install Playwright in your development environment,
then `node scripts/check-knowledge-browser.cjs`. Optional environment variables:
`PLAYWRIGHT_MODULE`, `CHROMIUM_PATH`, `KNOWLEDGE_PREVIEW_URL`, `KNOWLEDGE_SCREENSHOT`.
These select test tooling/output, not production configuration. Browser checks cover
root/prefixed routing, source preview, filtering, mobile layout, bilingual labels,
and text that resembles executable HTML. Normal backend tests run under `npm test`.

Deploying this feature does not collect anything. Review the Spacesuit knowledge
collector and explicitly publish a snapshot for the selected workspace/profile.
Keep real memories behind the dashboard's configured access controls; redaction is
defense in depth, not a replacement for access control. Public previews use fixtures.
