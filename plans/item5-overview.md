# Plans: Item 5 — Broader Language & Pattern Coverage + Effort/Detail Layers

> **Status:** NEEDS REVIEW — collection of linked plans for `plans/TO_DO.md` item 5.
> **Prerequisite:** Item 1 (end-to-end pipeline documentation) is DONE and merged
> (`docs/review-pipeline/`). These plans depend on those docs as the spec.
> **Branch:** `plans/item5-broader-coverage-effort`
> **Date:** 2026-08-20

## Scope of item 5 (from TO_DO)
1. Broaden file categorization, ignore patterns, and review pattern matching for **more languages and greater variation** (currently a limited set).
2. **Enhance reviews further** via **selectable layers of effort and detail** for the agents (e.g. lightweight "quick pass" vs. deep "thorough pass"), scaling prompt depth, file cap, parallelism, and token budget. Surface the layer in the UI, persist it per-analysis, and report it in the `complete`/estimate payloads.

## Why three plans
Item 5 is really three separable workstreams with different risk profiles and reviewers:

| Plan | Workstream | Risk | Depends on |
|---|---|---|---|
| [A. Broader languages & patterns](./item5-a-broader-languages.md) | `fileFilter.ts` pattern/language expansion | Low (config-like edits) | item 1 docs |
| [B. Effort / detail layers](./item5-b-b-effort-layers.md) | agent prompt + orchestration + API + UI + persistence | Medium-High (cross-cutting, schema + UI change) | item 1 docs; coordinates with provider plan |
| [C. Docs-sync maintenance](./item5-c-docs-sync.md) | keep `docs/review-pipeline/` accurate as A/B land | Low (process) | A, B |

Plan B is the largest and should be sequenced in phases (see its "Phases" section). Plan A can ship independently and first. Plan C is a standing requirement, not a one-time task.

## Standing rule (mirrors AGENTS.md)
Any change from A or B that alters file-selection rules, ignore/priority patterns, the agent
prompts or JSON schema, generation params (`temperature`/`max_tokens`), cost/pricing logic, or
`MAX_FILES_PER_PRIORITY` **must update the corresponding `docs/review-pipeline/` page** before merge.

## Open questions for reviewers
- Default effort layer (recommend `standard` to preserve today's behavior).
- UI placement of the effort selector (recommend the Analyze form, alongside priority).
- Whether effort is per-analysis or per-priority (recommend per-analysis, applied to all 3 priorities it runs).
- Whether `quick` should cap output severity (recommend no hard cap; just terser/fewer files + lower `max_tokens`).
