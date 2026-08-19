# Plan: Model / Provider Compatibility

> **Status: NEEDS REVIEW** — draft, not yet approved. Written 2026-08-19.
> Scope decision to confirm: focus near-term work on **OpenAI-compatible APIs only**;
> everything else is tracked as follow-up work behind an adapter abstraction.

**Repo:** codevibes-next (Vite/React/TS frontend + `codevibes-backend` Express/TS)

**Current state:** The backend is hardcoded to DeepSeek. All AI calls go through
`codevibes-backend/src/services/deepseekService.ts`, which talks to
`https://api.deepseek.com/v1/chat/completions` — an OpenAI-style `/chat/completions`
endpoint (Bearer auth, `messages`/`model`/`temperature`/`max_tokens`/`stream`, SSE
`data:` chunks ending in `[DONE]`). Model is configurable only via the
`DEEPSEEK_MODEL` env var (default `deepseek-chat`); API URL, pricing, and validation
are hardcoded. The frontend (SettingsModal, `saveDeepSeekKey`) is DeepSeek-specific
in naming and links. The GitHub side (file selection, priority categorization) is
provider-agnostic already.

---

## Background: how the AI call is made today

1. `analysisService.analyzeRepository()` collects files (see file-selection flow in
   `githubService.ts` / `fileFilter.ts`) and calls
   `deepseekService.streamAnalysis(files, apiKey, priority)`.
2. `streamAnalysis` picks a priority-specific system prompt (`PRIORITY_1_PROMPT`,
   `PRIORITY_2_PROMPT`, `PRIORITY_3_PROMPT`), formats files as
   `=== FILE: <path> ===\n<content>` blocks, and POSTs to the chat completions API
   with `stream: true`.
3. Streaming SSE lines are accumulated; on `[DONE]` the full content is parsed by
   `parseIssuesFromResponse()` into `AnalysisIssue[]`.
4. `tokenCounter.ts` estimates tokens and computes cost from **hardcoded DeepSeek
   pricing** (`INPUT_COST_PER_MILLION = 0.14`, `OUTPUT_COST_PER_MILLION = 0.28`).
5. `validateApiKey()` probes the same endpoint with `max_tokens: 1`.

Everything provider-specific is concentrated in one file plus one pricing module —
good news for a refactor.

---

## Proposed scope for the near-term work

**Support providers that expose an OpenAI-compatible chat-completions API**, since
DeepSeek already uses that shape and zero protocol translation is needed. The work
is: make provider config (base URL, model, auth, pricing) dynamic, expose it in the
API + UI, and keep DeepSeek as the default.

### Provider configuration model

A provider entry should carry:

| Field | Example (DeepSeek) | Notes |
|---|---|---|
| `id` | `deepseek` | stable key |
| `label` | `DeepSeek` | UI display name |
| `baseUrl` | `https://api.deepseek.com/v1` | chat completions path appended |
| `defaultModel` | `deepseek-chat` | may be overridden by user |
| `models` | `deepseek-chat`, `deepseek-reasoner` | optional: selectable list |
| `inputCostPerMillion` | `0.14` | feeds `calculateCost` |
| `outputCostPerMillion` | `0.28` | feeds `calculateCost` |
| `apiKeyLink` | `https://platform.deepseek.com/` | settings UI hint |

Config should live in a single backend module (e.g. `providers.ts` + a
`providerRegistry`), with an env-var escape hatch (e.g. `AI_BASE_URL`,
`AI_MODEL`, `AI_INPUT_COST`, `AI_OUTPUT_COST`) so self-hosting users can point at
any OpenAI-compatible endpoint without code changes (vLLM, Ollama, LM Studio,
proxy services).

### Suggested implementation steps (draft order)

1. **Extract an `aiProvider` abstraction in the backend.** Rename/refactor
   `deepseekService.ts` into a generic OpenAI-compatible client:
   `chatCompletions(files, apiKey, priority, provider)`; keep the priority prompts,
   file formatting, SSE parsing, and JSON extraction untouched (they're
   provider-agnostic already). Update `types/index.ts` (`AnalyzeRequest` gains
   `provider`/`model`), `analysisController.ts`, `analysisService.ts`.
2. **Provider registry + pricing.** Add `providers.ts` with DeepSeek as the
   default; move pricing out of `tokenCounter.ts` into the provider entry so
   `calculateCost` takes provider costs as parameters.
3. **API key storage generalization.** `authRoutes`/`encryption.ts` currently
   store a single DeepSeek key (`deepseek-key`). Add per-provider key storage
   (`provider:<id>`) with backward-compatible fallback to the existing stored key.
4. **Frontend settings.** Generalize `SettingsModal.tsx` + `api.ts`
   (`saveDeepSeekKey` → per-provider save) into a provider picker (dropdown +
   model selector + key field + "get key" link). Persist chosen provider alongside
   the key.
5. **Cost estimates.** `getEstimate()` uses provider-specific pricing; show which
   provider a cost estimate assumes.
6. **Validation.** Ship with DeepSeek as the default provider; manually verify
   streaming + estimates against at least one second provider from the list below
   before claiming support.

### OpenAI-compatible providers to consider (near-term candidates)

All of these expose an OpenAI-compatible chat completions endpoint (verify current
URLs/models/pricing before adding — don't rely on memory):

- **DeepSeek** — already integrated (default).
- **OpenAI** — the reference implementation (`api.openai.com/v1`).
- **OpenRouter** — single-key gateway over many models (gpt, claude, gemini,
  llama, etc.) with per-model pricing in its API metadata; strong candidate for
  maximum model choice with minimal code.
- **Groq** — fast inference, Llama/Mixtral/others.
- **Together AI**, **Fireworks AI** — hosted open-model endpoints.
- **Mistral** — OpenAI-compatible API available.
- **Moonshot (Kimi)**, **Zhipu GLM** — OpenAI-compatible endpoints.
- **Azure OpenAI** — OpenAI-compatible with an extra `api-version` query param
  and a different auth model (API key or Entra); slightly non-standard, treat as
  near-term-if-cheap, otherwise follow-up.
- **Self-hosted/local**: **vLLM**, **Ollama**, **LM Studio** — OpenAI-compatible
  `/v1/chat/completions`; makes local, offline, or proxy-based use possible with
  zero protocol code (this is a big win for the "generic base URL" config).

### Follow-up scope (broader expansion — track in TO_DO, not part of this plan)

Providers with non-OpenAI protocols need a request/response **adapter** layer, not
just config:

- **Anthropic** — Messages API (different endpoint shape, `x-api-key` header,
  non-streaming/streaming differences, `thinking` blocks).
- **Google Gemini** — `generativelanguage.googleapis.com` REST API (different
  request/response shape, `generateContent`/`streamGenerateContent`).
- **AWS Bedrock** — AWS SigV4 auth + per-model protocol variants.
- **Cohere**, **xAI** (OpenAI-compatible today but verify), **Groq's native
  format**, and others as they appear.

The adapter abstraction from the near-term work (a `ProviderClient` interface
returning normalized `{issues, inputTokens, outputTokens}`) should be designed so
these slot in later without reworking the analysis pipeline.

---

## Open decisions to confirm

- [ ] **Confirm near-term scope is OpenAI-compatible only** (recommended) vs. going
      straight for a multi-protocol adapter (Anthropic + Gemini) now.
- [ ] Provider config: registry in code (recommended for now) vs. runtime config in
      DB/settings.
- [ ] Per-provider API key storage: new `provider:<id>` keys with fallback vs.
      migrating existing stored key.
- [ ] Which second provider to validate against: OpenRouter (max model choice) vs.
      OpenAI itself vs. a local Ollama/vLLM instance (zero cost, tests the generic
      base URL path).
- [ ] Expose generic `AI_BASE_URL` env overrides to self-hosters, or keep it
      internal until providers are first-class?

## Related work

- TO_DO item: explore and document how codevibes works (file selection + reviewing
  agent instructions) — the doc it produces should reference this plan.
- `fileFilter.ts` / `githubService.ts` are provider-agnostic; no changes expected
  there.