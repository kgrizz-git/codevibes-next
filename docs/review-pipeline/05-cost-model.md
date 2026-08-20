# 5. Cost model — `codevibes-backend/src/utils/tokenCounter.ts`

CodeVibes uses an approximation for estimates and server-reported usage for completed analysis.

## Token and price model

- `CHARS_PER_TOKEN = 4`; `estimateTokens(text)` is `ceil(length / 4)`.
- `estimateOutputTokens(inputTokens)` assumes an output ratio of `0.2`.
- DeepSeek pricing is currently hard-coded: `$0.14` / 1M input tokens and `$0.28` / 1M output
  tokens. `calculateCost` is the single server-side calculation.

## Where cost is produced

- **Live analysis:** `analysisService` uses token counts from the provider stream (or its fallback
  estimate) and sends `complete.cost` and `complete.tokensUsed` for each priority.
- **Pre-analysis estimate:** each effort-capped priority uses 500 input tokens per file and the
  0.2 output ratio. Changing scope changes projected total cost without changing token rates.
- **Next-priority estimate:** derives an observed average input tokens per completed file.

The frontend accumulates the server `complete.cost` and `tokensUsed` values for its live display
and saved history. It must not reconstruct cost from a hard-coded client price.

## Provider follow-up

Pricing is not yet provider-aware. The provider work will add pricing status and cost basis from a
registry. If it introduces effort-specific prompts or output limits, it must revise the estimate
inputs too; the current scope-only effort layer deliberately leaves them unchanged.
