# 6. Extension hooks (forward-looking)

Where to make common review-pipeline changes.

## Add a language

- Add extensions to `fileFilter.ts` `SOURCE_EXTENSIONS`; `02-file-selection.md` describes the
  classifier.
- An unlisted extension is dropped unless an explicit direct rule selects it. Keep P1/P2 naming
  and directory conventions source-gated: `minimatch` with `matchBase` makes broad globs unsafe.
- Update the file-filter tests, file-selection reference, and generated pipeline contract.

## Add a selection rule

- Add a direct policy-file rule or a source-gated P1/P2 convention in `fileFilter.ts`.
- For Terraform, source `*.tf`/`*.tfvars` may be P1, but `.terraform/**` remains ignored.
- Avoid broad patterns such as `*main*`, `*test*`, or `*model*`; test false positives as well as
  the intended path.

## Add a model provider

- The legacy network/SSE path remains in `deepseekService.ts`, which must stay byte-for-byte
  unchanged until `USE_LEGACY_PROVIDER` is retired.
- Provider adapters own prompts, JSON-schema compatibility, output limits, and provider-specific
  prices. Update `04-reviewing-agent.md` and `05-cost-model.md` with that work.

## Extend effort layers

- Scope is configured in `config/effort.ts`: quick/standard/thorough layer caps are bounded by
  the global `MAX_FILES_PER_PRIORITY` cap. See `03-orchestration-sse.md`.
- The frontend remembers only the next-run preference and stores the chosen effort per analysis.
- Prompt depth and output limits are deferred to the routed provider; while legacy routing is
  active, effort is scope-only.

## Add live token streaming

`analysisService` currently discards provider `chunk` events. A future UI may relay them, but must
keep `complete` as the authoritative source for final token and cost accounting.
