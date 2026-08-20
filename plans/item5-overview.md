# Plans: Item 5 — Broader Language & Pattern Coverage + Effort/Detail Layers

> **Status:** NEEDS REVIEW — collection of linked plans for `plans/TO_DO.md` item 5.
> **Prerequisite:** Item 1 (end-to-end pipeline documentation) is DONE and merged
> (`docs/review-pipeline/`). These plans depend on those docs as the spec.
> **Branch:** `plans/item5-broader-coverage-effort`
> **Date:** 2026-08-20

## Scope of item 5 (from TO_DO)
1. Broaden file categorization, ignore patterns, and review pattern matching for **more languages and greater variation** (currently a limited set).
2. **Enhance reviews further** via **selectable layers of effort and detail** for the agents (e.g. lightweight "quick pass" vs. deep "thorough pass"), scaling prompt depth, file cap, and token budget. Surface the layer in the UI, persist it per-analysis, and report it in the `complete`/estimate payloads. (Parallelism is NOT in scope — `BATCH_SIZE` is hardcoded and untouched.)

## Why three plans
Item 5 is really three separable workstreams with different risk profiles and reviewers:

| Plan | Workstream | Risk | Depends on |
|---|---|---|---|
| [A. Broader languages & patterns](./item5-a-broader-languages.md) | `fileFilter.ts` pattern/language expansion | Low (config-like edits) | item 1 docs |
| [B. Effort / detail layers](./item5-b-b-effort-layers.md) | API + orchestration + UI + client-store persistence (**B-now**, no `deepseekService.ts` edit) + prompt-depth variants (**B-after-provider-Step-1**) | Medium-High (cross-cutting, schema + UI change) | item 1 docs; **blocked on provider plan Step 1 for prompt/`max_tokens` variants** |
| [C. Docs-sync maintenance](./item5-c-docs-sync.md) | keep `docs/review-pipeline/` accurate as A/B land, incl. regenerating `generated-contract.md` + `MAPPINGS` | Low (process) | A, B |

Plan B is split into **B-now** (file cap, API validation, `effort` in `complete`/estimate payloads, estimate math, UI `EffortSelector`, client-store persistence — none in the frozen file) and **B-after-provider-Step-1** (prompt-depth variants + per-model `max_tokens`, once the new provider path exists). Plan A can ship independently and first. Plan C is a standing requirement.

## Standing rule (mirrors AGENTS.md)
Any change from A or B that alters file-selection rules, ignore/priority patterns, the agent
prompts or JSON schema, generation params (`temperature`/`max_tokens`), cost/pricing logic, or
`MAX_FILES_PER_PRIORITY` **must update the corresponding `docs/review-pipeline/` page** before merge.

## Open questions for reviewers
- Default effort layer (recommend `standard` to preserve today's behavior).
- UI placement of the effort selector (recommend the Analyze form, alongside priority).
- Whether effort is per-analysis or per-priority (recommend per-analysis, applied to all 3 priorities it runs).
- Whether `quick` should cap output severity (recommend no hard cap; just terser/fewer files + lower `max_tokens`).
