# Plan C (Item 5) — Docs-Sync Maintenance

> **Status:** NEEDS REVIEW
> **Workstream:** keep `docs/review-pipeline/` accurate as Plans A and B land.
> **Part of:** `plans/item5-overview.md`. **Risk:** Low (process + doc edits).
> **Mirror of:** the rule already added to `AGENTS.md` (Documentation / Pipeline Reference).

## Purpose
Plans A and B change the exact things the pipeline reference documents. This plan is the
**standing checklist** that must be completed before any PR from A/B merges, so the docs remain
the source of truth (per `plans/TO_DO.md` item 5 and `AGENTS.md`).

## Trigger
Edit any of: file-selection rules, ignore/priority patterns, the GitHub fetch or SSE flow, the
agent prompts or their JSON schema, generation params (`temperature`/`max_tokens`), cost/pricing
logic, or the `MAX_FILES_PER_PRIORITY` knob.

## Checklist (map change → doc page)
| Code change | Doc page(s) to update |
|---|---|
| New language extensions / P1/P2 patterns (`fileFilter.ts`) | `02-file-selection.md` (catch-all + pattern lists); `06-extension-hooks.md` "Add a new language" example list |
| Effort layer added to `getPromptForPriority` (`deepseekService.ts`) | `04-reviewing-agent.md` (param + behavior); `docs/review-pipeline.md` quick-reference table |
| `MAX_FILES_PER_PRIORITY` / per-effort file cap, env knobs (`analysisService.ts`) | `03-orchestration-sse.md` (cap, estimate, `complete` payload); `docs/review-pipeline.md` table |
| `complete` / `estimate` payload shape (`analysisService.ts`, `analysisController.ts`) | `03-orchestration-sse.md` (event contract); `docs/review-pipeline.md` |
| Generation params `temperature`/`max_tokens` (`deepseekService.ts`) | `04-reviewing-agent.md`; `docs/review-pipeline.md` table |
| Cost/pricing logic (`tokenCounter.ts`) | `05-cost-model.md`; `docs/review-pipeline.md` table |
| SSE flow / error codes (`analysisService.ts`, `analysisController.ts`) | `03-orchestration-sse.md` (event ordering, error-code table) |
| New extension hook or changed "where to change X" | `06-extension-hooks.md` |
| Effort layer added to the **new** provider path (`aiProvider.ts` or `effortConfig.ts` — NOT `deepseekService.ts`) | `04-reviewing-agent.md` (param + behavior); `docs/review-pipeline.md` quick-reference table; repoint `06-extension-hooks.md` "Add selectable effort" from `deepseekService.ts` to the new path |
| `EFFORT_MAX_TOKENS` / `EFFORT_FILE_CAP` env knobs | `03-orchestration-sse.md` (env knobs); `.env.example` |

## Machine-checked contract (CI-blocking — must not be skipped)
`scripts/review-pipeline-contract.mjs` extracts P3 extensions, SSE events, `MAX_FILES_PER_PRIORITY`,
`AVG_TOKENS_PER_FILE`, `OUTPUT_RATIO`, `temperature`, and `max_tokens` from source and (re)generates
`docs/review-pipeline/generated-contract.md`. CI runs `check:pipeline-contract`, which **fails if
that file is stale**. Therefore, whenever Plans A/B change the P3 extension list, the cap/estimate
math, or `max_tokens`, the PR must run `npm run docs:pipeline-contract -- --write` and commit the
regenerated `generated-contract.md`.

Separately, `scripts/check-review-pipeline-docs.mjs` has a `MAPPINGS` object (source file → doc
page). If a new pipeline source file is introduced (e.g. `aiProvider.ts`, `effortConfig.ts`), the
`MAPPINGS` list must be extended so the check flags missing docs for it.

## Process
1. Author makes the code change on a branch (e.g. from Plan A or B).
2. Before marking the PR ready, updates the mapped doc page(s) with the new `file:line` refs.
3. CI/pre-merge review verifies the doc edit is present (human checklist; optionally a doc link
   lint in future). The merged-item-1 review assessment (`tmp/review-pipeline-doc-assessment-*.md`)
   is the template for a future accuracy re-check.
4. After merge, if line numbers shifted, a follow-up doc commit corrects `file:line` refs
   (cheap, like commit `849ec68` did).

## Acceptance
- Every PR from Plan A/B includes a corresponding `docs/review-pipeline/` edit.
- No PR merges with pipeline code changes but stale docs.
- `AGENTS.md` rule remains the canonical reminder; this plan is the operational checklist.
