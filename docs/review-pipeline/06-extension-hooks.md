# 6. Extension hooks (forward-looking)

A "where to change X" index so future work lands in the right place. Each item references the
doc page that covers the relevant code.

## Add support for a new language (TO_DO item 5 — broader coverage)
- **Primary edit:** `fileFilter.ts` `PRIORITY_3_PATTERNS` catch-all extension list
  (`02-file-selection.md`). Add the new extension(s) (e.g. `kt`, `swift`, `cs`, `c`, `cpp`).
- A file with an unlisted extension that doesn't match a P1/P2 pattern is currently **dropped**
  (`fileFilter.ts:265-266`) — so the catch-all is the single gate.
- Watch the `MAX_FILES_PER_PRIORITY` cap so a broader P3 doesn't starve P1/P2 in the UI flow.

## Add a new file/pattern rule (TO_DO item 5 — greater variation)
- Extend `IGNORE_PATTERNS`, `PRIORITY_1_PATTERNS`, or `PRIORITY_2_PATTERNS` in `fileFilter.ts`
  (`02-file-selection.md`). Prefer `minimatch` globs (`dot`/`matchBase` already enabled).

## Add a new model provider (provider plan)
- Network layer + SSE parsing live in `deepseekService.ts` (`04-reviewing-agent.md`):
  endpoint, `MODEL`, request body, streaming reader, `[DONE]` handling, `decoder.flush()`.
- **Known SSE gaps to fix there:** missing `decoder.flush()` after the read loop, plus
  `[DONE]` handled via `continue` (`:831-863`). Note `done` carries no data payload, so the gap
  is the uncalled `flush()` (theoretical multi-byte edge case), not a dropped chunk.
- Make pricing provider-aware: replace the hardcoded constants in `tokenCounter.ts`
  (`05-cost-model.md`) with a provider registry (`pricingStatus`/`costBasis`).
- `getPromptForPriority` assumes an OpenAI-compatible chat completions shape; adapters needed
  for Anthropic/Gemini/etc. (provider plan scope).

## Add selectable effort / detail layers (TO_DO item 5 — enhance reviews)
- **Prompt depth:** extend `getPromptForPriority(priority)` in `deepseekService.ts`
  (`04-reviewing-agent.md`) — e.g. a `quick` variant appends "report only CRITICAL/HIGH, be
  terse"; a `thorough` variant adds depth. Keep the enforced JSON schema intact.
- **Scope / budget:** scale `MAX_FILES_PER_PRIORITY` (`03-orchestration-sse.md`, env knob) and
  `max_tokens: 8000` (`deepseekService.ts:729,805`) per layer.
- **Estimates:** adjust the hardcoded `AVG_TOKENS_PER_FILE = 500` and `OUTPUT_RATIO = 0.2`
  (`03-orchestration-sse.md`, `05-cost-model.md`) so UI estimates stay honest per layer.
- **Client surface:** expose the layer in `AnalyzePage` (SSE consumer), persist per-analysis,
  and report it in the `complete`/`estimate` payloads (mirror how `priority` and `cost` flow today).

## Add live token streaming (enhancement)
- `analysisService.ts:164-166` currently discards `chunk` events from `streamAnalysis`. Wire
  those into a live "thinking" UI instead of waiting for `complete`.
