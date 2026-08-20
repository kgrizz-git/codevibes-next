# 5. Cost model — `codevibes-backend/src/utils/tokenCounter.ts`

How CodeVibes estimates tokens and computes cost. Approximation-based (no tiktoken, for speed).

## Token estimation
- `CHARS_PER_TOKEN = 4` (`:7`) — ~4 chars per token for code.
- `estimateTokens(text)` (`:17`): `text ? ceil(len / 4) : 0`.
- `estimateTokensForFiles(contents)` (`:25`): sum over files.
- `estimateOutputTokens(inputTokens)` (`:52`): `ceil(input * 0.2)` — assumes ~20% output.

## Pricing (hardcoded to DeepSeek `deepseek-chat`)
- `INPUT_COST_PER_MILLION = 0.14` (`:10`)
- `OUTPUT_COST_PER_MILLION = 0.28` (`:11`)
- `calculateCost(inputTokens, outputTokens)` (`:35`):
  `input/1e6*0.14 + output/1e6*0.28` → USD.

## Display & aggregate helpers
- `formatCost(cost)` (`:44`): `` `$` + cost.toFixed(6) `` (e.g. `$0.000123`).
- `getFullEstimate(fileContents)` (`:59`): returns
  `{ inputTokens, outputTokens, totalTokens, estimatedCost }` using the helpers above.

## Where cost is produced
- **Live analysis**: `analysisService.ts:179` calls `calculateCost(input, output)` with the
  token counts from `deepseekService` (actual `usage` when available, else estimates).
  Streaming path estimates output via `estimateTokens(fullContent)` (`deepseekService.ts:870`).
- **Pre-analysis estimate**: `analysisService.getEstimate` (`:236`) uses
  `AVG_TOKENS_PER_FILE = 500` and `OUTPUT_RATIO = 0.2` (`analysisService.ts:257-258`)
  to project per-priority and total cost without calling the model.
- **Next-priority estimate**: `analysisService.ts:183-195` projects the following priority's
  tokens from the observed `avgTokensPerFile`.

## Notes for downstream work (provider plan + item 5)
- Pricing is **not provider-aware** — it assumes DeepSeek `deepseek-chat` rates. The provider
  plan adds `pricingStatus` (`current`/`stale`/`unknown`) and `costBasis` to the estimate/complete
  payloads, sourced from a provider registry rather than these two constants.
- `CHARS_PER_TOKEN = 4` is a code-centric approximation; non-Latin or data-heavy files will be
  off. An effort layer (item 5) that changes prompt size should keep `calculateCost` as the
  single source of truth so the UI cost stays consistent.
