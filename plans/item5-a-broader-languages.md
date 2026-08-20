# Plan A (Item 5) — Broader Language & Pattern Coverage

> **Status:** NEEDS REVIEW
> **Workstream:** expand `fileFilter.ts` for more languages and greater pattern variation.
> **Part of:** `plans/item5-overview.md`. **Prereq:** item 1 docs (`docs/review-pipeline/02-file-selection.md`).
> **Risk:** Low — pattern-list edits, fully covered by existing `fileFilter.test.ts`.

## Current state (verified against `fileFilter.ts`)
- Language support is implicit via the **P3 catch-all extension list** (`PRIORITY_3_PATTERNS`,
  `:212-222`): `js ts jsx tsx py java go rb php rs`. Any other extension not matching a P1/P2
  pattern is **dropped** (`:265-266`).
- Pattern variation lives in `IGNORE_PATTERNS` (`:10`), `PRIORITY_1_PATTERNS` (`:86`),
  `PRIORITY_2_PATTERNS` (`:139`). Matcher is `minimatch` with `{ dot: true, matchBase: true }`
  (`:229`).
- Tests: `codevibes-backend/src/utils/fileFilter.test.ts` already exercises priority assignment
  and ignore logic — extend it for new cases.

## Goals
1. **More languages:** add common source extensions to the P3 catch-all so they enter the
   review funnel (e.g. `kt swift cs c cpp h hpp scala kotlin tsx already present m swift rust
   already present rb already present`). Propose: `kt, swift, cs, c, cpp, h, hpp, scala, ex, exs,
   dart, lua, r, pl, sh, bash, zsh, vue, svelte`.
2. **Greater pattern variation:** add widely-used framework/language conventions to P1/P2 so
   security/business-logic files are caught beyond the current English-dir-name assumptions:
   - P1: `**/oauth/**`, `**/jwt/**`, `**/session/**`, `**/iam/**`, `**/vault/**`,
     `*.env.*` (broader env variants), `.envrc`.
   - P2: `**/graphql/**`, `**/resolvers/**`, `**/mutations/**`, `**/queries/**`
     (already used for SQL), `**/workers/**`, `**/jobs/**`, `**/tasks/**`.
   - Ignore: add `.terraform/**`, `*.tfvars`, `dist/`, already present; consider
     `**/__pycache__/**` glob form, `*.lock` already covered.
3. **Determinism check:** confirm first-match-wins ordering still produces sensible tiers after
   additions (P1 > P2 > P3). Add tests asserting new patterns land in the intended priority.

## Proposed changes (`fileFilter.ts`)
- Extend `PRIORITY_3_PATTERNS` catch-all line to include the new extensions.
- Append to `PRIORITY_1_PATTERNS` / `PRIORITY_2_PATTERNS` the new dir/keyword globs.
- Keep `minimatch` glob style; avoid enumerating every framework (prefer `**/graphql/**` over
  `**/graphql/**` + `**/graphql.ts` redundancy).
- Update the `getPriorityDescription`/UI labels only if a new *named* tier is introduced
  (not needed for this plan — still 3 tiers).

## Tests
- Add cases to `fileFilter.test.ts`:
  - A `kt`/`swift`/`c` file with no P1/P2 match → priority 3.
  - A `**/graphql/resolvers/x.ts` → priority 2.
  - A `.envrc` → priority 1.
  - A `.terraform/...` → ignored.
- Keep total file ≤ 500 lines (quality-gate cap); if it grows, split test cases into a co-located
  `__tests__` data file (does not count against the cap the same way, but stay tidy).

## Docs sync (Plan C)
- Update `docs/review-pipeline/02-file-selection.md`:
  - New extensions in the P3 catch-all list (`:212-222`).
  - New P1/P2 patterns.
- Update `docs/review-pipeline/06-extension-hooks.md` "Add a new language" example list to match.

## Acceptance
- `npm run typecheck` + `npm test` (backend) pass.
- New patterns verified by added tests; no regression in existing priority assignments.
- `docs/review-pipeline/02-file-selection.md` and `06-extension-hooks.md` updated to match.
- `scripts/check-file-size` passes (no oversized file introduced).

## Out of scope
- Effort/detail layers (Plan B). Prompt text changes (Plan B). Provider abstractions (provider plan).
