# Operations map first implementation

Goal: shared work graph from bounded Linear/Jira exports and runtime assignment records, displayed through outcome/role/agent/topic lenses. Explicit source links are observations; missing-link suggestions remain inferred with evidence. No auto-assignment or status writes.

Acceptance: profile/source isolation, native parent/ID/status preservation, bounded inputs, safe text rendering, source freshness/partial coverage, no weighted-completion or schedule claims, multi-role aggregation without double-counting.

Implementation: provider adapters/graph compiler in Spacesuit; generic snapshot reader/validator plus browser operations-map in Command Center. Standalone no-source empty state and synthetic interactive preview.

Verification: normalization/hierarchy/cycle/unknown/duplicate-scope/proposal tests; generic host safety/identity/limits; synthetic cross-repository fixture validation; root/prefix/mobile/bilingual/lens/selection browser checks. Full existing suites and CI.

Not included: installed live task sync, semantic embedding clustering, automatic recommendations/execution, ETA forecasting. Existing unmerged branches preserved.
