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
