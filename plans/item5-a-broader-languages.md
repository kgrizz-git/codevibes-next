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
1. **More languages (extension coverage is the real lever):** add common source extensions to
   the P3 catch-all (`PRIORITY_3_PATTERNS`, `:212-221`) so they enter the review funnel. Clean
   proposed list (note: `tsx`, `swift`, `rust`/`rs`, `rb` are already present; do NOT re-add):
   `kt, cs, c, cpp, h, hpp, scala, ex, exs, dart, lua, r, pl, sh, bash, zsh, vue, svelte`.
   - **Author's actual stack (priority):** `.dart` (Flutter app) and `.cs` (C#) are the
     highest-value additions — both are currently absent and would otherwise be dropped. Python
     (`.py`) is already covered. Ensure these land in the extension list.
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

## Folder-structure & language generality (currently a gap)
The current patterns assume **English, convention-over-configuration layouts** (e.g.
`**/controllers`, `**/services`, `**/components`, `src/...`). This misses real-world repos:
- **Non-standard / monorepo layouts:** `packages/*/src`, `apps/*`, `libs/`, `pkg/`, `cmd/`,
  `internal/`, `crates/`, `modules/`, `features/`.
- **Non-English directory names:** `contrôleurs/`, `servicios/`, `控制层/` — `minimatch` glob
  patterns won't match them, so those files fall through to P3 catch-all (or are dropped).
- **Languages with no extension or unconventional extensions** (e.g. Go `main`, shell without
  `.sh`, build scripts) — already partially dropped today.

**Reality check — these are NOT common TypeScript layouts.** `packages/`+`apps/` are monorepo
workspace conventions (only for multi-package repos); `internal/`+`cmd/` are Go; `crates/` is
Rust. A *standard* TS app is flat (`src/components`, `src/services`, `src/utils`, `src/pages`) —
which the current patterns already cover. So broad glob additions like `**/packages/**/src` would
mostly add noise for typical repos and solve a problem most users don't have.

**The real generality gap is language + naming, not folder shape.** Representative real-world
layouts (e.g. this repo's author): TS apps with ad-hoc subfolders under `src/` such as
`src/gui`, `src/frontend`, `src/backend`, and arbitrary others; Python packages (often no `src/`
at all — `myproject/__init__.py`); one Flutter/Dart app; one C#. The actual problems:
1. **Unrecognized extensions get dropped** — `.dart` (Flutter) and `.cs` (C#) are NOT in the P3
   catch-all, so those repos fall outside the funnel entirely. This is the highest-priority fix.
2. **P1/P2 rely on English keyword folder names** (`**/services`, `**/auth`, `**/controllers`).
   Non-standard or non-English names (`src/backend`, `negocio/`, `控制层/`) won't match → land in
   P3 or get dropped. Prioritization is weak for anything not in an English-named dir.
3. **Non-standard layouts still land in P3** (reviewed, just lower priority) — acceptable, because
   the extension catch-all funnels them in. The only true failure is the *drop* case (unrecognized
   extension), fixed by (1).

Two design directions:
- **(A) Make defaults general via extensions + name-signals (recommended):** extend the P3
  extension list (`.dart`, `.cs`, …), and make P1/P2 match by **language-agnostic name signals**
  (filenames/dirs containing `auth`, `secret`, `config`, `db`, `model`, `route`, `test`,
  `security`) rather than assuming English structural dirs exist. This helps `src/backend/foo.py`
  and `negocio/bar.cs` alike, and is low-risk.
- **(B) Per-project user-tweakable patterns:** let users override ignore list / P1/P2 globs /
  extension set per repo (Settings or repo config). Much higher risk (UI, persistence,
  validation, security — user globs widen attack surface / can break `minimatch`) and overlaps the
  provider plan's eventual config story. **Defer** to a later, separate plan; note as limitation.

**Decision for this plan:** pursue (A). Drop the monorepo/Go/Rust globs. Language coverage is
about *extensions*; prioritization is about *name signals*, not assumed folder structure.
Explicitly **defer (B)**. Add tests asserting `src/backend/foo.py` (name signal → P2) and a
`.dart` file (extension → at least P3) land in sensible tiers.

## In-app transparency: show what is (and isn't) being reviewed
Today the UI lists the matched file paths per priority (`AnalyzePage.tsx:613-624`) but gives
**no explanation of *why* a file was selected or which patterns matched, and no view of the ignore
rules**. Users with non-standard layouts cannot tell if their code is being reviewed. This plan
must add (frontend, likely in Plan B's UI phase or a small standalone UI task):
- A **"review scope" surface** near the file list that shows: the active ignore patterns, the
  recognized language/extension set, and the priority rules — so users see *what folder and file
  patterns are passed* (not just a flat path list).
- Per-file or per-priority hint of **which rule matched** (e.g. "matched `**/auth/**` → P1"),
  and a clear **"N files ignored (node_modules, build output, …)"** count with a drill-down.
- This pairs with the effort-layer UI (Plan B): the scope surface + effort selector live together
  in the pre-analysis view so users understand both *what* and *how deep* is reviewed.
- Keep it read-only/derived from the same `fileFilter` rules the backend uses (no client-only
  copy that can drift — the contract script / backend should be the source of truth).

## Proposed changes (`fileFilter.ts`)
- Extend `PRIORITY_3_PATTERNS` catch-all line to include the new extensions.
- Append to `PRIORITY_1_PATTERNS` / `PRIORITY_2_PATTERNS` the new dir/keyword globs.
- **Broaden P1/P2 by name-signals, not folder shape** (see reality check above): add
  language-agnostic patterns keyed on filenames/dirs containing `auth`, `secret`, `config`,
  `db`/`database`, `model`, `route`/`router`, `security`, `test` (already partly present — fill
  gaps and add `**/*model*`, `**/*route*`, `**/*security*`-style signals). Prefer `**/*signal*`
  minimatch over assuming English structural dirs.
- Do NOT add monorepo/Go/Rust folder globs (`packages/`, `apps/`, `internal/`, `cmd/`, `crates/`)
  — they are not common TS layouts and add noise.
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
  - **Real-layout cases (not monorepo/golang):** `src/backend/foo.py` matches a name-signal →
    P2; a `.dart` file (Flutter) and a `.cs` file (C#) enter the funnel at ≥ P3. Proves coverage
    for the author's actual repos (TS ad-hoc subfolders, Python packages, Flutter, C#), not
    assumed folder shapes.
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
  `.env.example` still excluded by the new env patterns; structural-layout cases pass.
- **In-app transparency delivered:** a read-only "review scope" surface shows the active ignore
  patterns, recognized language/extension set, priority rules, per-file matched rule, and an
  ignored-file count — so users see *what folder/file patterns are passed* (not just a path list).
  Deferred: per-project user-editable patterns (tracked as a known limitation / future plan).
- `docs/review-pipeline/02-file-selection.md` and `06-extension-hooks.md` updated to match.
- `npm run check:pipeline-contract` and `npm run check:pipeline-docs` pass (contract regenerated
  and committed if the P3 list changed).
- `scripts/check-file-size` passes (no oversized file introduced).

## Out of scope
- Effort/detail layers (Plan B). Prompt text changes (Plan B). Provider abstractions (provider plan).
- **Per-project user-tweakable patterns (folder/ignore globs):** explicitly deferred. The
  recommended MVP makes defaults structure-agnostic (direction A) rather than user-editable
  (direction B). Revisit as a separate plan if users need overrides; coordinate with the
  provider plan's eventual config story and weigh the `minimatch`/security implications.
