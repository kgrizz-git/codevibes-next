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
1. **More languages:** add common source extensions to the P3 catch-all (`PRIORITY_3_PATTERNS`,
   `:212-221`) so they enter the review funnel. Clean proposed list (note: `tsx`, `swift`,
   `rust`/`rs`, `rb` are already present; do NOT re-add):
   `kt, cs, c, cpp, h, hpp, scala, ex, exs, dart, lua, r, pl, sh, bash, zsh, vue, svelte`.
   - **Terraform:** decide explicitly — either add `*.tf` to the P3 catch-all (or a P1
     `.tfvars`-adjacent rule) so Terraform is reviewed, OR state it is out of scope. Do not add
     `.terraform/**` + `*.tfvars` to IGNORE without also funneling `*.tf`, or Terraform code
     stays entirely unreviewed. Extensionless scripts (e.g. `bin/deploy`) remain dropped — note it.
2. **Greater pattern variation:** add widely-used framework/language conventions to P1/P2 so
   security/business-logic files are caught beyond the current English-dir-name assumptions:
   - P1: `**/oauth/**`, `**/jwt/**`, `**/session/**`, `**/iam/**`, `**/vault/**`,
     `.envrc` (single-file, not a glob that hits `.env.example`).
   - P2: `**/graphql/**`, `**/resolvers/**`, `**/mutations/**`, `**/workers/**`,
     `**/jobs/**`, `**/tasks/**`.
   - **Do NOT add `**/queries/**` to P2** — it is already in P1 (`:130`); first-match-wins means
     P2 additions there are a no-op. Leave it in P1.
   - **Do NOT use `*.env.*`** — with `minimatch({ dot: true })`, that glob matches
     `.env.example` / `.env.template` / `.env.sample`, which are *deliberately excluded*
     (`fileFilter.ts:94-96`, prompt false-positive guard `deepseekService.ts:51`). Use enumerated
     variants (`.env.staging`, `.env.integration`, …) and, if desired, add
     `.env.example`/`.env.template`/`.env.sample` to `IGNORE_PATTERNS` to be explicit.
   - Ignore: add `.terraform/**` only if paired with a `*.tf` funnel decision above.
3. **Determinism check:** confirm first-match-wins ordering still produces sensible tiers after
   additions (P1 > P2 > P3). Add tests asserting new patterns land in the intended priority,
   **including a test that `.env.example` stays unmatched (not pulled into P1) after any env
   pattern changes**.

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
  - New extensions in the P3 catch-all list (`:212-221`).
  - New P1/P2 patterns (and note if `**/queries/**` stays in P1).
- Update `docs/review-pipeline/06-extension-hooks.md` "Add a new language" example list to match.
- **Regenerate the machine-checked contract:** changing the P3 extension list makes
  `docs/review-pipeline/generated-contract.md` stale. CI `check:pipeline-contract` will FAIL unless
  you run `npm run docs:pipeline-contract -- --write` and commit the regenerated file (see Plan C).
  If a new pipeline source file is introduced, extend `MAPPINGS` in
  `scripts/check-review-pipeline-docs.mjs` (Plan C).

## Acceptance
- `npm run typecheck` + `npm test` (backend) pass.
- New patterns verified by added tests; no regression in existing priority assignments;
  `.env.example` still excluded by the new env patterns.
- `docs/review-pipeline/02-file-selection.md` and `06-extension-hooks.md` updated to match.
- `npm run check:pipeline-contract` and `npm run check:pipeline-docs` pass (contract regenerated
  and committed if the P3 list changed).
- `scripts/check-file-size` passes (no oversized file introduced).

## Out of scope
- Effort/detail layers (Plan B). Prompt text changes (Plan B). Provider abstractions (provider plan).
