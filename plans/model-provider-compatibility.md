# Plan: Model / Provider Compatibility

> **Status: NEEDS REVIEW** — draft, not yet approved. Written 2026-08-19.
> **Revision 4:** incorporates two external review rounds (see Revision log).
> Scope decision to confirm: near-term work focuses on **OpenAI-compatible APIs
> only**; everything else is tracked as follow-up work behind an adapter
> abstraction.

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
   `calculateCost` is called from **8 sites**: analysisService.ts:179/193/271/277/283,
   deepseekService.ts:752/871, plus tokenCounter.ts:68 inside `getFullEstimate` —
   **and the frontend re-hardcodes the same DeepSeek pricing in 3 more places**
   (see F1 below). "8 sites" here means the backend; the frontend sites are
   enumerated in the §F1 risk and Step 2.

### Facts the plan previously got wrong (corrected, verified 2026-08-19)

- **API key storage is a user-record column, not a route/namespaced store.** Keys
  are persisted via `authController.saveDeepSeekKey` (PUT `/api/auth/deepseek-key`)
  → `updateUser(req.user.id, { deepseek_key: apiKey })`; the column is
  `deepseek_key TEXT` on the `users` table (database.ts:36), encrypted at rest by
  `database.ts` (`encryptToken`/`decryptTokenField`). `encryption.ts` only provides
  the ciphertext primitives. Any per-provider key work is therefore a **DB
  schema/column migration**, not a key-store renamespacing.
- **The DB key is write-only in the live request path — the analyze flow never
  reads it.** `analysisController.ts:18,26-29` requires `apiKey` in `req.body`
  (400 if missing) and never falls back to `req.user.deepseek_key`, even though
  `optionalAuth` decrypts it in memory (database.ts:139-147). The key actually
  travels through **two divergent client-side stores**:
  - `AnalyzePage` → zustand persist store `codevibes-storage`
    (`analysisStore.ts:113`, apiKey set from `SetupPage`),
  - the home-page snippet analyzer (`Index.tsx` → `useAnalysis`) →
    `SettingsModal`'s `getStoredApiKey()` from a **separate** localStorage key
    `vibeguard_deepseek_api_key` (SettingsModal.tsx:20,113; useAnalysis.ts:23).
  - `saveDeepSeekKey` (api.ts:293) is **defined but never invoked anywhere in
    src/** — the PUT `/api/auth/deepseek-key` endpoint is dead from the client.
  Any per-provider key work must first decide the key source of truth (§Open
  Decision: key source of truth) and unify these stores; Step 3 is rewritten
  around that decision.
- **`validateApiKey()` (deepseekService.ts:885) is dead code** — exported but never
  imported or called anywhere. The key validation UX must be wired or dropped as
  part of this work.
- **Non-streaming `analyzeFiles()` (deepseekService.ts:694) is also unused.** The
  live path is `streamAnalysis` only. `analyzeFiles` must be scoped/deprecated/deleted
  explicitly, or it becomes a second copy of provider coupling.
- **The snippet-analysis path is a second consumer the plan previously missed.**
  `useAnalysis` POSTs `/api/analyze` with `repoUrl: 'code-snippet'`
  (useAnalysis.ts:39-44, called from Index.tsx) — but `parseGitHubUrl('code-snippet')`
  cannot match, so this live call site likely errors already. It needs the same
  dead-code-hygiene decision as `analyzeFiles`/`validateApiKey`: thread
  `provider`/`model` through it or declare it broken/delete it.
- **Frontend hardcodes DeepSeek pricing 3×** (missed in Rev 2's "all call sites"
  enumeration, which was backend-only): `AnalyzePage.tsx:391` (cost persisted to
  history), `AnalyzePage.tsx:1042` (live cost display), `ResultsPage.tsx:162`
  (history cost display) — all `(tokens/1e6) * 0.14`. These must consume the
  server-computed, provider-aware cost instead.

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
| `pricingAsOf` | `2026-08-19` | date pricing was last verified; drives staleness flags (see "Pricing freshness") |
| `pricingSource` | `https://api-docs.deepseek.com/quick_start/pricing` | where the numbers were verified against; machine-readable for a subset (OpenRouter `/api/v1/models`) |
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

### Pricing freshness (staleness detection)

Cost estimates are only as good as the pricing data behind them, so the registry
records **when** each provider's pricing was verified (`pricingAsOf` + a
`pricingSource` URL) and the system treats that as a first-class concern:

- **Pricing status** for a provider is derived: `current` (verified within
  `PRICING_STALE_AFTER_DAYS`, default 90), `stale` (older), or `unknown`
  (no `pricingAsOf`, e.g. env-override `custom` provider where costs come from
  `AI_INPUT_COST`/`AI_OUTPUT_COST`).
- **User-visible flags (keep the estimates, label them honestly):** cost figures
  shown in estimates/results carry a badge — "Pricing verified 2026-08-19",
  "Pricing may be out of date (verified >90d ago)", or "Pricing unknown —
  estimate only". We do **not** discard cost estimates when pricing is stale or
  unknown: the numbers are still directionally useful, but they must never be
  presented as authoritative. A "metered" (real `usage` from the API) vs
  "estimated" (token-count estimate) distinction is **introduced by this work**
  (§2.3 — it does not exist in the live `complete` event or frontend today); the
  pricing badge is an orthogonal axis layered on top of it.
- **Metered-cost exception:** if a provider reports real `usage` and real
  per-token cost is unknown (e.g. Ollama local), show the metered token counts
  and "cost N/A — self-hosted/local" rather than fabricating a dollar figure.
- **CI check (scheduled):** a GitHub Actions cron workflow (e.g. weekly,
  `pricing-check.yml`) runs `scripts/check-pricing.mjs` which:
  - For providers with **machine-readable** pricing (OpenRouter `/api/v1/models`
    returns per-model cost metadata): fetches live numbers, diffs against the
    registry, and opens a PR (or fails + opens an issue) on drift so a human can
    update `inputCostPerMillion`/`outputCostPerMillion` + `pricingAsOf`.
  - For providers with **page-only** pricing (DeepSeek, OpenAI, Anthropic, ...):
    can't diff automatically — the script instead fails/opens an issue when any
    provider's `pricingAsOf` exceeds the staleness threshold ("pricing review
    due for provider X — check `pricingSource`"), which is the manual-review
    nudge. The workflow is allowed to fail; it's informational, not a merge gate.
  - The script is also runnable locally (`npm run check-pricing`) so pricing
    updates are a deliberate, recorded act: you bump the numbers **and** the date
    in one commit.

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
- **Replace string-sniffed error routing with typed error codes** —
  `analysisService.ts:221-224` routes errors via
  `error.message.includes('API key')` / `.includes('rate limit')`. Parameterizing
  labels happens to preserve those substrings, which is fragile; while touching
  every error site anyway, throw a typed error carrying `code:
  'INVALID_API_KEY' | 'RATE_LIMITED'` (or a custom error class) and route on the
  code.
- **Fix the SSE frame-buffer bug** (see §2.2): accumulate raw bytes and split on
  `\n` only at frame boundaries (carry a partial line across `read()` chunks),
  instead of the current per-read `chunk.split('\n')` which drops partial `data:`
  lines that straddle reads. **Two tail cases included:** call `decoder.flush()`
  once `done` is seen (a multi-byte char can straddle the final read), and process
  any carried remainder after the read loop ends, not only inside it.
- Normalize `delta.content ?? delta.text` for providers that emit `delta.text`.
- **Abort upstream on client disconnect** — `analysisController.ts:48-50` already
  logs `req.on('close')` but the fetch runs to completion (analysisService.ts:163),
  burning a full paid call for users who close the tab. Wire
  `AbortController`/`signal` from the controller through `streamAnalysis` to the
  upstream fetch; on abort, release the reader lock and stop.

**Done when:** `streamAnalysis` streams identically against DeepSeek with the same
prompts/parse behavior; error strings interpolate provider label; error routing
uses typed codes; SSE parser passes the new buffer-split + tail tests (§4); client
disconnect aborts the upstream fetch within a bounded time.

### Step 2 — Provider registry + pricing

Add `providers.ts` with DeepSeek as default; move pricing into provider entries.
`calculateCost` **changes signature** to
`calculateCost(inputTokens, outputTokens, inputCostPerMillion, outputCostPerMillion)`
— this is a **deliberate breaking change across 8 backend call sites**
(analysisService.ts ×5, deepseekService.ts ×2, tokenCounter.ts `getFullEstimate`
×1) **plus 3 frontend sites** that re-hardcode `(tokens/1e6) * 0.14`:
`AnalyzePage.tsx:391` (cost persisted to history via `saveAnalysis`),
`AnalyzePage.tsx:1042` (live cost display), `ResultsPage.tsx:162` (history cost
display). Update all backend call sites in the same commit; do not add a default
that silently falls back to DeepSeek pricing. **The frontend must stop computing
cost itself** — the `complete` SSE event already carries server-computed
`cost`/`tokensUsed`; make the three display/persist sites consume that (extended
per Step 6 with `provider`, `model`, `pricingStatus`), so a single source of
truth exists.

**Done when:** every backend call site passes provider costs; a unit test asserts
non-DeepSeek pricing produces expected numbers and that no call site compiles with
the old arity (typecheck); the 3 frontend pricing sites render/persist the
server-computed cost and contain no `0.14` literal.

### Step 3 — API keys: unify client stores, then per-provider keys

**Prerequisite — key source of truth (see Open Decision):** the analyze path takes
the key from `req.body` today, and there are **two divergent client stores**
(`codevibes-storage` zustand for `AnalyzePage`, `vibeguard_deepseek_api_key`
localStorage for the snippet path) plus a **write-only** DB column and a dead
`PUT /api/auth/deepseek-key` client call. Recommended decision: **keep
request-body keys** (no server-side key resolution; simplest and matches current
behavior), which means:

1. **Unify the client stores** — one key store (provider + key + model) consumed
   by both `AnalyzePage` and `useAnalysis`; migrate `vibeguard_deepseek_api_key`
   readers/writers to it. `SetupPage` and `SettingsModal` write to the same store.
2. **Resolve the dead endpoint**: wire `saveDeepSeekKey`/PUT
   `/api/auth/deepseek-key` into the unified save flow (server-side encrypted
   storage as a convenience) or delete it — no half-wired paths. If kept, it must
   become per-provider (`provider_key_<id>` columns, following the repo's informal
   `CREATE TABLE IF NOT EXISTS` + `try { ALTER TABLE } catch` migration pattern at
   database.ts:64-71, or a `provider_keys` JSON column).
3. **Key fallback matrix (no cross-provider reuse):** user selects provider X →
   use the client-stored key for X; missing → "add a key for X" error. **Never**
   reuse another provider's key (a user's DeepSeek key must not be silently sent
   to a third party). Env-var `AI_BASE_URL` self-hosters: key may come from
   `AI_API_KEY` env var as a deliberate override (documented).
   If the alternative decision (server-side resolution) is chosen instead, the
   fallback matrix moves to the backend, body `apiKey` becomes optional, and the
   two client stores must still be unified first.

**Also:** wire up or drop `validateApiKey()` (dead code today) — recommend wiring
it into the Settings modal "test key" flow with the selected provider. And decide
`analyzeFiles()` fate: keep only if a non-streaming path is desired (it does read
real `usage`); otherwise delete to avoid a second provider-coupled entrypoint.
Same hygiene applies to the snippet path (`useAnalysis`/`Index.tsx`
`repoUrl: 'code-snippet'`, which cannot pass `parseGitHubUrl`): thread
`provider`/`model` through it or declare it broken and remove it.

**Done when:** one client key store serves both analyze flows; the
`PUT /api/auth/deepseek-key` path is wired or deleted; fallback matrix covered by
tests; `validateApiKey` and the snippet path each have an explicit fate;
migration (if any) follows the repo's informal pattern and existing users' stored
keys still load.

### Step 4 — Frontend settings + full DeepSeek-brand surface

Generalize `SettingsModal.tsx` + `api.ts` (`saveDeepSeekKey` → per-provider save)
into a provider picker: provider dropdown, model selector (from static `models`
list), key field, "get key" link, and a "test key" button that calls the wired
`validateApiKey`. Persist chosen provider + key. Cost estimates show which provider
and pricing they assume.

**"DeepSeek" is hardcoded across the UI beyond the settings modal — enumerate and
generalize all touchpoints** (verified): `SetupPage.tsx:87-95`, `HomePage.tsx:120-122`
("Test Connection") and `:349-351` (copy), `DocumentationPage.tsx:39,107,142-150`
(incl. "Upcoming support for … Ollama" — already anticipates providers),
`Footer.tsx:20`, `ActivityCards.tsx:59` ("Running DeepSeek AI analysis…"),
`SettingsModal.tsx:59,86` (label + platform link), `ApiReferencePage.tsx:190,283`,
plus the model-name string in copy that is stale vs the `deepseek-chat` default.
Provider-agnostic wording ("AI analysis", provider name from the registry).

**Done when:** switching provider changes endpoint/model/key/link; DeepSeek remains
the default; no user-facing "DeepSeek" string remains in flows that work with other
providers (the provider's own label/link renders instead); existing stored DeepSeek
keys still load.

### Step 5 — Controller validation, docs + tests + release gate

- **Controller-level validation of provider/model (backend must reject, not
  registry tests only):** `analysisController.ts` currently destructures only
  `repoUrl, apiKey, priority`. Add `provider`/`model` validation — unknown provider
  id → 400 with the valid list; model outside the provider's `models` allowlist →
  400 with the valid list. Thread `provider` through **`GET /api/estimate`** too
  (query param, currently `repoUrl` only — analysisController.ts:89-113) so
  estimates use the right pricing.
- README/setup: document provider picker, per-provider keys, and the env-var
  contract (§ above) for self-hosters.
- API docs for the changed key endpoint and new `AnalyzeRequest.provider`/`model`
  fields.
- Release gate (manual, demoted from being the only verification): validate against
  at least one second real provider from the §candidate list.

**Done when:** invalid provider/model rejected with 400 + valid lists; `GET
/estimate` honors `provider`; docs updated; tests green (§4); one second provider
validated and recorded.

### Step 6 — Pricing freshness: CI check + UI flags + history schema

- Add `scripts/check-pricing.mjs` (runnable locally + in CI) implementing the
  pricing-freshness logic above: machine-readable diff for OpenRouter, staleness
  check (`pricingAsOf` age vs `PRICING_STALE_AFTER_DAYS`, default 90) for all
  providers, clear exit codes/messages.
- Add `pricing-check.yml` cron (weekly) running the script; on findings it opens
  an issue (or PR for machine-diffable drift). Informational, not a merge gate.
- Backend: expose `pricingStatus` (`current` | `stale` | `unknown`) + `pricingAsOf`
  per provider in the estimate/complete payloads (from the registry, cheap — no
  network).
- **Persist provider/model in the `analyses` row** (database.ts:42-57 has
  `cost`/`tokens_used` but no provider/model), so history rows stay unambiguous
  ("$0.82 on DeepSeek" vs "on OpenRouter") — add `provider`, `model`, and a
  cost-basis flag (`metered` | `estimated`) columns, following the repo's informal
  migration pattern (`CREATE TABLE IF NOT EXISTS` + `try { ALTER TABLE } catch`,
  database.ts:64-71). `saveAnalysis` + history display (`ResultsPage`) surface
  them.
- Frontend: render the status badge next to cost figures in
  `AnalyzePage`/`ResultsPage` estimate cards and the Settings provider picker;
  "pricing unknown" states show token counts + "cost N/A" (never a fabricated
  dollar figure). The `complete` event's `cost`/`tokensUsed` + new
  `provider`/`model`/`pricingStatus` are the single source for the three
  display/persist sites enumerated in Step 2.

**Done when:** staleness logic unit-tested; local `npm run check-pricing` passes
with current data and fails with a clear message on stale/drifted data; cron
workflow exists; `analyses` rows record provider/model/cost-basis; estimate UI
shows correct badge for `current`/`stale`/`unknown`.

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
  vs `content`, (d) `delta.text` shape, (e) `[DONE]`, (f) malformed/partial JSON,
  (g) **multi-byte char straddling the final read** (decoder flush), (h) **final
  `data:` line arriving without a trailing `\n`** (post-loop remainder).
- **`parseIssuesFromResponse`**: markdown-wrapped JSON, empty `issues`, missing
  `category`/`severity` normalization, `undefined` line.
- **`calculateCost` / provider pricing**: per-provider numbers; asserts the new
  signature has no DeepSeek-default fallback.
- **Provider registry**: DeepSeek default resolution, env-override precedence
  (§Env-var contract), unknown-provider handling, `baseUrl`+path concatenation,
  **env values read at import time vs per-request** (see Open Decision — tests
  must not race module init).
- **Pricing freshness**: `current`/`stale`/`unknown` derivation (threshold
  boundary, missing `pricingAsOf`, env-override custom provider), and
  `check-pricing.mjs` behavior for both machine-diffable (OpenRouter) and
  page-only (DeepSeek) sources.
- **Abort path**: client disconnect mid-stream → upstream fetch aborted and reader
  released (Step 1).
- **Controller validation**: unknown `provider`/`model` → 400 with valid lists;
  `GET /estimate` honors `provider` (Step 5).

Integration tests (recommended): mocked OpenAI-compatible SSE endpoint (local stub
or `nock`) asserting the normalized `{issues, inputTokens, outputTokens, cost}`
shape — makes second-provider support claimable without a paid account. Key
source-of-truth/fallback matrix (Step 3) incl. the unified client store.

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
- [ ] **Key source of truth for analysis (P0 — decides Step 3's design):** (a)
      keep request-body keys and unify the two client stores
      (`codevibes-storage` zustand vs `vibeguard_deepseek_api_key` localStorage),
      wiring or deleting the currently-dead `PUT /api/auth/deepseek-key`
      (recommended — matches today's flow, no server-side resolution); (b) resolve
      keys server-side from the user record (body `apiKey` optional; makes the DB
      columns meaningful but requires changing `analyze` and unifying the client
      stores anyway); or (c) hybrid with an explicit precedence rule. The two
      half-settled checkboxes below (storage shape, `validateApiKey` fate) follow
      from this choice rather than being free votes.
- [ ] Per-provider key storage shape: additive `provider_key_<id>` columns
      (recommended, zero migration) vs. `provider_keys` JSON column (one
      migration, cleaner long term) — only if server-side key resolution is chosen.
- [ ] `validateApiKey`: wire into Settings "test key" (recommended) vs. drop.
- [ ] `analyzeFiles` (non-streaming, unused): keep for a future non-streaming path
      vs. delete.
- [ ] Snippet-analysis path (`useAnalysis`/`Index.tsx`, `repoUrl: 'code-snippet'` —
      already can't pass `parseGitHubUrl`): thread `provider`/`model` through vs.
      declare broken and remove (same hygiene as `analyzeFiles`).
- [ ] `AI_*` env values read **at import time** (matches `deepseekService.ts:17`
      today) vs. per-request — import-time is simpler and testable; document
      whichever so tests don't race module init.
- [ ] Streaming `usage` capture: implement `stream_options: { include_usage: true }`
      (recommended) vs. document estimate-only accounting.
- [ ] Staleness threshold: 90 days (`PRICING_STALE_AFTER_DAYS`) — right default?
- [ ] CI pricing check action on drift: auto-PR for machine-diffable providers
      (recommended) vs. issue-only.
- [ ] Live pricing follow-up: use OpenRouter's `/api/v1/models` per-model pricing
      at runtime (kills staleness for that provider) vs. registry + flags only.
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

- **Rev 4 (2026-08-19):** incorporates round-2 external review (all P0/P1/P2 items
  verified against code). Corrected the key-flow premise: the analyze path takes
  the key from `req.body` and the DB column is write-only; there are two
  divergent client stores (`codevibes-storage` vs `vibeguard_deepseek_api_key`)
  and a dead `PUT /api/auth/deepseek-key` client call — Step 3 rewritten around a
  key-source-of-truth decision (request-body recommended) + client store
  unification. Enumerated the 3 frontend hardcoded-pricing sites (missed in Rev
  2's backend-only count) and made the `complete` event the single cost source.
  Added `provider`/`model`/cost-basis persistence to the `analyses` schema
  (informal `try/ALTER` migration pattern). Step 1 now includes typed error codes
  (replacing string-sniffed routing), `decoder.flush()` + post-loop remainder in
  the SSE fix, and client-disconnect → `AbortController`. Step 4 enumerates the
  full "DeepSeek"-branded UI touchpoint list; Step 5 adds controller-level
  `provider`/`model` validation incl. `GET /estimate`. Fixed the metered-vs-
  estimated over-claim (it's introduced by this work) and the 7-vs-8 site count;
  added snippet-path fate + env read-timing decisions.
- **Rev 3 (2026-08-19):** added pricing freshness as a first-class concern —
  `pricingAsOf`/`pricingSource` on provider entries, `current`/`stale`/`unknown`
  derivation, user-visible status badges on cost figures (estimates kept but
  labeled; never discarded, never fabricated for unknown pricing), scheduled
  `check-pricing.mjs` CI cron (machine-diff for OpenRouter, staleness nudge for
  page-only providers) as a new Step 6, staleness tests, and related open
  decisions.
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