# Plan: Model / Provider Compatibility

> **Status: NEEDS REVIEW** — draft, not yet approved. Written 2026-08-19.
> **Revision 2:** addresses external review (see §7 — revision log). Scope decision
> to confirm: near-term work focuses on **OpenAI-compatible APIs only**; everything
> else is tracked as follow-up work behind an adapter abstraction.

**Repo:** codevibes-next (Vite/React/TS frontend + `codevibes-backend` Express/TS)

**Current state:** The backend is hardcoded to DeepSeek. All AI calls go through
`codevibes-backend/src/services/deepseekService.ts`, which talks to
`https://api.deepseek.com/v1/chat/completions` — an OpenAI-style `/chat/completions`
endpoint (Bearer auth, `messages`/`model`/`temperature`/`max_tokens`/`stream`, SSE
`data:` chunks ending in `[DONE]`). Model is configurable only via the
`DEEPSEEK_MODEL` env var (default `deepseek-chat`); API URL and pricing are
hardcoded. The frontend (SettingsModal, `saveDeepSeekKey`) is DeepSeek-specific in
naming and links. The GitHub side (file selection, priority categorization) is
provider-agnostic already.

---

## Background: how the AI call is made today (verified against code)

1. `analysisService.analyzeRepository()` collects files (see file-selection flow in
   `githubService.ts` / `fileFilter.ts`) and calls
   `deepseekService.streamAnalysis(files, apiKey, priority)` (analysisService.ts:161).
2. `streamAnalysis` picks a priority-specific system prompt (`PRIORITY_1_PROMPT`,
   `PRIORITY_2_PROMPT`, `PRIORITY_3_PROMPT`), formats files as
   `=== FILE: <path> ===\n<content>` blocks, and POSTs to the chat completions API
   with `stream: true`.
3. Streaming SSE lines are accumulated; on `[DONE]` the full content is parsed by
   `parseIssuesFromResponse()` into `AnalysisIssue[]`.
4. `tokenCounter.ts` estimates tokens and computes cost from **hardcoded DeepSeek
   pricing** (`INPUT_COST_PER_MILLION = 0.14`, `OUTPUT_COST_PER_MILLION = 0.28`).
   `calculateCost` is called from **7 sites**: analysisService.ts:179/193/271/277/283,
   deepseekService.ts:752/871, plus tokenCounter.ts:68 inside `getFullEstimate`.

### Facts the plan previously got wrong (corrected, verified 2026-08-19)

- **API key storage is a user-record column, not a route/namespaced store.** Keys
  are persisted via `authController.saveDeepSeekKey` (PUT `/api/auth/deepseek-key`)
  → `updateUser(req.user.id, { deepseek_key: apiKey })`; the column is
  `deepseek_key TEXT` on the `users` table (database.ts:36), encrypted at rest by
  `database.ts` (`encryptToken`/`decryptTokenField`). `encryption.ts` only provides
  the ciphertext primitives. Any per-provider key work is therefore a **DB
  schema/column migration**, not a key-store renamespacing.
- **`validateApiKey()` (deepseekService.ts:885) is dead code** — exported but never
  imported or called anywhere. The key validation UX must be wired or dropped as
  part of this work.
- **Non-streaming `analyzeFiles()` (deepseekService.ts:694) is also unused.** The
  live path is `streamAnalysis` only. `analyzeFiles` must be scoped/deprecated/deleted
  explicitly, or it becomes a second copy of provider coupling.

---

## Proposed scope for the near-term work

**Support providers that expose an OpenAI-compatible chat-completions API**, since
DeepSeek already uses that shape and zero protocol translation is needed. The work
is: make provider config (base URL, model, auth, pricing) dynamic, expose it in the
API + UI, and keep DeepSeek as the default.

### Provider configuration model

A provider entry carries:

| Field | Example (DeepSeek) | Notes |
|---|---|---|
| `id` | `deepseek` | stable key |
| `label` | `DeepSeek` | UI display name |
| `baseUrl` | `https://api.deepseek.com/v1` | **contract: must include the API prefix up to (but not including) the endpoint path; client appends `/chat/completions`.** For OpenAI/Ollama/vLLM-style servers this is `…/v1`; DeepSeek today is `…/v1`. |
| `endpointPath` | `/chat/completions` | default; overridable for oddballs (Azure) |
| `authScheme` | `bearer` | `bearer` \| `none` (vLLM/Ollama without auth) \| `query` (Azure `api-version`) |
| `headers` | `{}` | optional static extra headers (e.g. OpenRouter `HTTP-Referer`/`X-Title`) |
| `defaultModel` | `deepseek-chat` | may be overridden by user |
| `models` | `['deepseek-chat', 'deepseek-reasoner']` | **static allowlist for MVP; no dynamic model fetch** (OpenRouter model discovery is follow-up) |
| `maxTokens` | `8000` | optional per-provider cap; must not exceed what the model supports (see §2.1) |
| `inputCostPerMillion` | `0.14` | feeds `calculateCost` |
| `outputCostPerMillion` | `0.28` | feeds `calculateCost` |
| `apiKeyLink` | `https://platform.deepseek.com/` | settings UI hint |
| `streamingUsage` | `true` | whether the API returns `usage` on the stream (see §2.3) |

Config lives in a single backend module (`providers.ts` + `providerRegistry`,
**code-registry for the near-term, not DB** — see Open Decision #3).

### Env-var override contract (self-hosting escape hatch)

- `AI_BASE_URL`, `AI_MODEL`, `AI_INPUT_COST`, `AI_OUTPUT_COST` override the
  **default (DeepSeek) provider only**, not arbitrary registry entries. Rationale:
  self-hosters replacing the endpoint wholesale need one override path; per-provider
  env vars for every registry entry is scope creep.
- Precedence: **env override > registry value**. If `AI_BASE_URL` is set, the
  effective provider is a synthetic "custom" provider (id `custom`, label "Custom
  (env)") — the registry entry's URL/model/costs are ignored, auth stays `bearer`
  unless `AI_AUTH=none` is also set.
- `AI_BASE_URL` must be a full base (e.g. `http://localhost:11434/v1`); the client
  appends `/chat/completions` per the baseUrl contract above. Document this exact
  contract in README; it is the #1 self-hoster footgun.

---

## Implementation steps (with acceptance criteria)

### Step 1 — Extract a generic OpenAI-compatible client

Refactor `deepseekService.ts` into an `aiProvider.ts` client:
`chatCompletions(files, apiKey, priority, provider)` + `streamAnalysis(…)` with the
same signature plus `provider`. Keep priority prompts, file formatting, JSON
extraction untouched (they're provider-agnostic). Update `types/index.ts`
(`AnalyzeRequest` gains `provider`/`model`), `analysisController.ts`,
`analysisService.ts`.

**Also in this step (small, easy to miss):**
- Parameterize all error messages by provider label — today they throw
  `'Invalid DeepSeek API key'` / `'DeepSeek rate limit exceeded'` /
  `'DeepSeek API error'` (deepseekService.ts:738/741/743/814/817/819). After the
  refactor an OpenAI/Groq user must not see "DeepSeek" in errors.
- **Fix the SSE frame-buffer bug** (see §2.2): accumulate raw bytes and split on
  `\n` only at frame boundaries (carry a partial line across `read()` chunks),
  instead of the current per-read `chunk.split('\n')` which drops partial `data:`
  lines that straddle reads.
- Normalize `delta.content ?? delta.text` for providers that emit `delta.text`.

**Done when:** `streamAnalysis` streams identically against DeepSeek with the same
prompts/parse behavior; error strings interpolate provider label; SSE parser passes
the new buffer-split tests (§4).

### Step 2 — Provider registry + pricing

Add `providers.ts` with DeepSeek as default; move pricing into provider entries.
`calculateCost` **changes signature** to
`calculateCost(inputTokens, outputTokens, inputCostPerMillion, outputCostPerMillion)`
— this is a **deliberate breaking change across 8 call sites**
(analysisService.ts ×5, deepseekService.ts ×2, tokenCounter.ts `getFullEstimate`
×1). Update all call sites in the same commit; do not add a default that silently
falls back to DeepSeek pricing.

**Done when:** every call site passes provider costs; a unit test asserts
non-DeepSeek pricing produces expected numbers and that no call site compiles with
the old arity (typecheck).

### Step 3 — Per-provider API key storage (DB migration)

`users.deepseek_key` → support multiple keys. Near-term option: keep the existing
`deepseek_key` column as the **DeepSeek key** and add `provider_key_<id>` columns
for new providers (simplest, no data migration). Long-term option: `provider_keys`
JSON column (requires migrating existing rows' ciphertext).

**Key fallback matrix (no cross-provider reuse):**
- User selects provider X → use `provider_key_X` if present.
- User selects **DeepSeek** and has no `deepseek_key` → 401-style "add a key"
  error (current behavior).
- User selects provider X ≠ DeepSeek and has no `provider_key_X` → error; **never**
  fall back to `deepseek_key` or any other provider's key (security footgun —
  a user's DeepSeek key must not be silently sent to a third party).
- Env-var `AI_BASE_URL` self-hosters: key may come from `AI_API_KEY` env var as a
  deliberate override (documented).

**Also:** wire up or drop `validateApiKey()` (dead code today) — recommend wiring it
into the Settings modal "test key" flow with the selected provider. And decide
`analyzeFiles()` fate: keep only if a non-streaming path is desired (it does read
real `usage`); otherwise delete to avoid a second provider-coupled entrypoint.

**Done when:** schema migration applied, old `deepseek_key` still works for DeepSeek
users, fallback matrix covered by tests, `validateApiKey` either live or removed.

### Step 4 — Frontend settings

Generalize `SettingsModal.tsx` + `api.ts` (`saveDeepSeekKey` → per-provider save)
into a provider picker: provider dropdown, model selector (from static `models`
list), key field, "get key" link, and a "test key" button that calls the wired
`validateApiKey`. Persist chosen provider + key. Cost estimates show which provider
and pricing they assume.

**Done when:** switching provider changes endpoint/model/key/link; DeepSeek remains
the default; existing stored DeepSeek keys still load.

### Step 5 — Docs + tests + release gate

- README/setup: document provider picker, per-provider keys, and the env-var
  contract (§ above) for self-hosters.
- API docs for the changed key endpoint and new `AnalyzeRequest.provider`/`model`
  fields.
- Release gate (manual, demoted from being the only verification): validate against
  at least one second real provider from the §candidate list.

**Done when:** docs updated; tests green (§4); one second provider validated and
recorded.

---

## Risks & edge cases (must address, not copy)

### 2.1 Per-provider `max_tokens` / model capabilities
`max_tokens: 8000` is hardcoded (deepseekService.ts:729/805). Many providers/models
cap lower (local Ollama models, some OpenAI models) → silent truncation or 400s.
Provider entry carries optional `maxTokens`; absent → 8000 default.

### 2.2 SSE streaming parsing is brittle (bug exists today — fix, not copy)
Current parser (deepseekService.ts:837-862) assumes one `data:` line per chunk
boundary. Real issues: a single SSE event can span two `read()` chunks and the
current per-read `split('\n')` **drops the partial line** — intermittent stream
corruption. Providers may emit `delta.role`, `finish_reason`, or `delta.text`
instead of `delta.content`. Fix with a frame buffer + `delta.content ?? delta.text`
normalization (Step 1).

### 2.3 Token/cost accounting differs by provider
The live streaming path **never reads real `usage`** — it estimates output tokens
from content (deepseekService.ts:870). Non-streaming `analyzeFiles` does read
`usage`. With provider-aware pricing, estimates become the only numbers users see.
Decision: capture streaming `usage` where supported (DeepSeek/OpenAI emit it at
`[DONE]` with `stream_options: { include_usage: true }`), and **explicitly
document estimate-only accounting** for providers that never return usage (Ollama).
Provider `streamingUsage` flag drives this.

### 2.4 `calculateCost` breaking change
See Step 2. All 8 call sites updated in one commit; no silent DeepSeek-pricing
fallback.

### 2.5 Header / auth differences within "OpenAI-compatible"
The umbrella is looser than it looks: OpenRouter wants `HTTP-Referer`/`X-Title`
headers; Ollama may send no auth and no `usage`; vLLM serves whatever model is
loaded; Azure needs `api-version` query param + different auth. The provider entry's
`authScheme` (`bearer`|`none`|`query`) + optional static `headers` covers all of
these with ~20 lines.

### 2.6 Key fallback
See Step 3 matrix. No cross-provider key reuse, ever.

### 2.7 `baseUrl` + path contract
Defined in the config table: `baseUrl` includes the API prefix (`/v1`), client
appends `/chat/completions` (or `endpointPath`). This contract is the difference
between the "generic base URL" win working and not.

### 2.8 Error messages
Parameterized by provider label (Step 1).

---

## Testing strategy

Unit tests (mandatory before merge; harness exists — `utils/encryption.test.ts`,
`utils/fileFilter.test.ts`; new files e.g. `services/aiProvider.test.ts`,
`utils/tokenCounter.test.ts`):

- **SSE parser** (highest ROI — encodes the §2.2 bug fix): (a) `data:` event split
  across two `read()` chunks, (b) multiple events per chunk, (c) `reasoning_content`
  vs `content`, (d) `delta.text` shape, (e) `[DONE]`, (f) malformed/partial JSON.
- **`parseIssuesFromResponse`**: markdown-wrapped JSON, empty `issues`, missing
  `category`/`severity` normalization, `undefined` line.
- **`calculateCost` / provider pricing**: per-provider numbers; asserts the new
  signature has no DeepSeek-default fallback.
- **Provider registry**: DeepSeek default resolution, env-override precedence
  (§Env-var contract), unknown-provider handling, `baseUrl`+path concatenation.

Integration tests (recommended): mocked OpenAI-compatible SSE endpoint (local stub
or `nock`) asserting the normalized `{issues, inputTokens, outputTokens, cost}`
shape — makes second-provider support claimable without a paid account. Key-storage
fallback matrix (Step 3).

Manual validation: keep the §Step 5 release-gate check against one real second
provider — as a release gate, not the sole verification.

---

## Docs to update

- README/setup: env-var contract + provider picker (self-hosters).
- `aiProvider.ts` header comment: the OpenAI-compatible contract + the adapter
  boundary future non-OpenAI providers must implement (one paragraph so the next
  dev doesn't re-couple).
- API docs: changed key endpoint, new `AnalyzeRequest.provider`/`model` fields.
- Link from the "explore how codevibes works" TO_DO doc to this plan.

---

## OpenAI-compatible providers to consider (near-term candidates)

All expose an OpenAI-compatible chat completions endpoint (verify current
URLs/models/pricing before adding — don't rely on memory):

- **DeepSeek** — already integrated (default).
- **OpenAI** — reference implementation (`api.openai.com/v1`).
- **OpenRouter** — single-key gateway over many models; per-model pricing in API
  metadata; needs `HTTP-Referer`/`X-Title` for some tiers.
- **Groq**, **Together AI**, **Fireworks AI** — hosted open-model endpoints,
  genuinely compatible.
- **Mistral** — OpenAI-compatible API available.
- **Moonshot (Kimi)**, **Zhipu GLM** — OpenAI-compatible endpoints.
- **Azure OpenAI** — OpenAI-compatible with `api-version` query param + different
  auth; treat as near-term-if-cheap via `authScheme: 'query'`, else follow-up.
- **Self-hosted/local**: **vLLM**, **Ollama**, **LM Studio** — OpenAI-compatible
  `/v1/chat/completions`; enables local/offline/proxy use with zero protocol code.
  Caveats: auth may be `none`, `usage` may be absent.

## Follow-up scope (broader expansion — track in TO_DO, not part of this plan)

Providers with non-OpenAI protocols need a request/response **adapter** layer, not
just config:

- **Anthropic** — Messages API (different endpoint shape, `x-api-key` header,
  `thinking` blocks).
- **Google Gemini** — `generativelanguage.googleapis.com` REST API.
- **AWS Bedrock** — SigV4 auth + per-model protocol variants.
- **Cohere**, **xAI** (OpenAI-compatible today but verify), others.

The `ProviderClient` interface from the near-term work (returning normalized
`{issues, inputTokens, outputTokens}`) should be designed so these slot in later
without reworking the analysis pipeline.

---

## Open decisions to confirm

- [ ] **Confirm near-term scope is OpenAI-compatible only** (recommended) vs.
      multi-protocol adapters now.
- [x] **Provider config: code registry for now** (resolved in this revision) — DB
      config later only if users need runtime provider editing; migration path is a
      `providers` table seeded from the registry.
- [ ] Per-provider key storage: additive `provider_key_<id>` columns (recommended,
      zero migration) vs. `provider_keys` JSON column (one migration, cleaner long
      term).
- [ ] `validateApiKey`: wire into Settings "test key" (recommended) vs. drop.
- [ ] `analyzeFiles` (non-streaming, unused): keep for a future non-streaming path
      vs. delete.
- [ ] Streaming `usage` capture: implement `stream_options: { include_usage: true }`
      (recommended) vs. document estimate-only accounting.
- [ ] Which second provider to validate against: OpenRouter (max model choice) vs.
      OpenAI itself vs. local Ollama/vLLM (zero cost, tests the `authScheme: none`
      + no-usage path).

## Related work

- TO_DO item: explore and document how codevibes works (file selection + reviewing
  agent instructions) — the doc it produces should reference this plan.
- `fileFilter.ts` / `githubService.ts` are provider-agnostic; no changes expected
  there.

---

## Revision log

- **Rev 2 (2026-08-19):** incorporates external critical review. Corrected the
  key-storage model (user-record `deepseek_key` column, DB migration — not a
  key-store renamespacing); flagged `validateApiKey`/`analyzeFiles` as dead code
  and decided their fate; defined the `baseUrl`/path + env-override contracts;
  added per-provider `maxTokens` + `authScheme`/`headers`; called out the SSE
  frame-buffer bug as a must-fix (with tests); resolved streaming-`usage` question;
  flagged `calculateCost` as a breaking change with all 8 call sites enumerated;
  defined the no-cross-provider key fallback matrix; parameterized error messages;
  added testing and docs sections; resolved registry-vs-DB; added acceptance
  criteria per step.
- **Rev 1 (2026-08-19):** initial draft, NEEDS REVIEW.