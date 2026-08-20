# Plans: Item 5 — Broader Language Coverage and Effort Layers

> **Status:** REVIEWED — ready to implement in the stated order.
> **Prerequisite:** the review-pipeline reference in `docs/review-pipeline/` remains the
> implementation spec. `deepseekService.ts` must remain byte-for-byte intact until the provider
> migration retires `USE_LEGACY_PROVIDER`.
> **Date reviewed:** 2026-08-20

## Scope

1. Admit more source and infrastructure languages into the review funnel, and make the existing
   TypeScript, Go, and Rust support use their real entry-point conventions.
2. Add a per-analysis `quick` / `standard` / `thorough` setting. It must control scope now,
   prompt/output budget once the new provider path is live, be visible in the UI, and be retained
   with saved analysis history.

`BATCH_SIZE` remains 5. Increasing fetch parallelism is explicitly out of scope.

| Plan | Deliverable | Ordering / important boundary |
|---|---|---|
| [A. Broader languages and patterns](./item5-a-broader-languages.md) | safe, tested classifier expansion | Can ship first and independently. |
| [B. Effort layers](./item5-b-effort-layers.md) | API, scope caps, UI, history, then prompt/output variants | Scope/history work can ship before the provider migration; prompt and output-token changes cannot. |
| [C. Documentation and contract maintenance](./item5-c-docs-sync.md) | docs and source-contract checks | Required in every A/B PR, not a deferred cleanup. |

## Decisions made by this review

- The default is `standard`; its file cap and legacy prompt behavior remain today's behavior.
- Effort is captured when an analysis starts and is reused for all three priority passes. The
  selector is disabled while a run is active or awaiting approval, so one saved analysis cannot
  mix effort levels.
- Terraform is in scope: `.tf` and `.tfvars` are reviewed as P1 infrastructure/security inputs;
  `.terraform/**` is ignored. Extensionless scripts remain outside this item.
- The classifier must not use unrestricted `**/*main*`, `**/*test*`, `**/*model*`, or similar
  globs. With `matchBase: true`, those patterns also promote documentation and unrelated names
  (for example `domain.ts` matches `*main*`). New P1/P2 rules must be exact conventions or be
  restricted to recognized reviewable extensions.
- “Persisted per-analysis” means the saved `analyses` history record stores the resolved effort.
  Remembering a user's last selector value is a separate convenience only.
- A static “review scope” explanation is useful, but a per-file rule trace and ignored-file
  drill-down require a deliberate backend contract. They are not hidden inside Plan A's low-risk
  classifier patch; Plan B specifies the bounded API/UI work needed if included in the release.

## Standing documentation rule

Any change to file selection, prompts/schema, generation parameters, cost/estimate logic, SSE
payloads, or file-cap configuration updates the corresponding `docs/review-pipeline/` page in the
same PR. Run both documentation checks before merge. Plan C has the exact mapping and commands.

## Deferred work

- Per-repository user-editable glob rules. This needs validation, persistence, support UX, and a
  clear security/abuse model; it is not config-like work.
- Extensionless executable detection and language inference from shebangs.
- Fetch parallelism and live model-token streaming.
