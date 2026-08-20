# 0003 — Structural Line-Limit Policy and Legacy Exception

- **Status:** Accepted
- **Date:** 2026-08-20
- **Owner:** Documentation/agent-guidance workstream
- **Review date:** on `USE_LEGACY_PROVIDER` retirement and quarterly until all
  legacy ceilings are removed

## Context

`scripts/check-file-size.mjs` fails any file exceeding `MAX_LINES = 500` and
additionally greps staged non-TS files for machine-specific absolute paths
(`/Users/`, `/home/`, `C:\`). The line gate applies to the whole repo; the
absolute-path gate is skipped under `plans/`.

Several files currently exceed the 500-line cap (`sidebar.tsx`, `HomePage.tsx`,
`AnalyzePage.tsx`, `codevibes-backend/src/services/deepseekService.ts` per
`plans/TO_DO.md`). They need a bounded exception rather than an advisory gate:
otherwise a known issue can silently grow and new violations can land.

Markdown files are excluded from the line-count gate: documentation is instead
checked by `check-doc-links` and `check-guidance`. The structural limit remains
focused on source and configuration files.

`deepseekService.ts` is under a hard constraint (see `AGENTS.md` and
`plans/TO_DO.md`): it must stay **byte-for-byte intact** until the legacy
provider is retired (`USE_LEGACY_PROVIDER`). It cannot be split like the other
oversized files.

## Decision

- **Line policy:** target ≤ 500 lines per file (`MAX_LINES` in
  `scripts/check-file-size.mjs`). Excluded paths: `node_modules`, `dist`,
  `package-lock.json`, `bun.lockb`, `.husky`, `public`.
- **Blocking with ceilings:** `check:structure` runs in hooks and CI. The four
  current oversized files are listed in `scripts/structural-exceptions.json`
  with their current line counts as non-increasing ceilings. Every other source
  file is limited to 500 lines. Remove an exception as soon as its file reaches
  the standard cap; lowering a ceiling is always safe.
- **Complexity ratchet:** `check:complexity` runs in pre-commit and CI as a
  blocking, shrink-only baseline
  for ESLint structural diagnostics: complexity (15), depth (5), nesting (3),
  function length (120), and source-file length (500). A newly introduced or
  worsened diagnostic fails; refactoring removes it from the baseline.
- **Legacy provider exception:** `deepseekService.ts` remains constrained by its
  byte-for-byte rule until `USE_LEGACY_PROVIDER` is retired. Its line ceiling
  protects against accidental growth; remove the exception with the provider
  migration.

## Consequences

- New files must stay under all standard limits; a violation blocks CI.
- Legacy files may not get worse. Their exceptions are explicit, reviewable,
  and can only shrink as cleanup lands.
- `deepseekService.ts` remains an acknowledged temporary exception, protected
  both by its byte-for-byte rule and its line ceiling.

## Supersedes / Superseded-by

- Supersedes: none
- Superseded-by: a record retiring the `deepseekService.ts` exception when the
  provider migration completes.
