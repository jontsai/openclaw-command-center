# PR #51 maintainer fixes

## Goal

Preserve the contributor's Intel/Pipeline/Monetization feature and authorship while fixing reproduced correctness and rendering vulnerabilities on current main.

## Acceptance criteria

- Markdown cells keep their column positions when blank, reordered or truncated; escaped pipes do not shift columns.
- Unknown/non-numeric/zero/negative revenue is not counted as active revenue.
- Markdown priority cannot create HTML attributes; only known priority classes are used.
- Empty/missing input directories remain a safe empty state.
- Regression tests, full tests, lint, build and formatting pass; synthetic browser preview is checked.

## Scope

Shared small table-row helper, pipeline/monetization readers, priority rendering, targeted panel tests and regenerated bundle. No new dependencies, runtime config, live deployment, or opinionated feature redesign.

## Verification

Reproduce failures against submitted code, apply fixes, rerun the targeted tests and full project checks. Use synthetic fixtures only. Retain original contributor commits as ancestors; fixes are authored by the configured AI identity with human coauthor credit.

## Verification

- 191 tests pass, including nine new panel regressions.
- Lint: zero errors, 13 existing warnings. Build, formatting, repository checks, and diff whitespace checks pass.
- Synthetic desktop/mobile previews use the actual panel markup and render functions; three firms, one positive-revenue firm, and no horizontal overflow at 1440px or 390px.
- This does not change the existing always-visible panel design. Making panels optional is a separate product decision.
- Contributor commits remain in ancestry; maintainer fixes do not rewrite their authorship.
