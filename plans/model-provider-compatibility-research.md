# Research: Model / Provider Compatibility (evidence for the plan)

> **Companion to `plans/model-provider-compatibility.md`** (the actionable plan,
> status NEEDS REVIEW, Rev 5). This doc is the verified research and design
> evidence the plan stands on: how the AI call works today, facts corrected during
> review, provider config model, env-var contract, pricing-freshness design,
> risks/edge cases, and candidate-provider research. File references verified
> 2026-08-19; updated for the round-3 (2026-08-19T14-22) review.

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
   (see "Facts corrected" below). "8 sites" means the backend; the frontend sites
   are enumerated in the risks section and plan Step 2.

## Facts the plan previously got wrong (corrected, verified 2026-08-19)

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
  Any per-provider key work must first decide the key source of truth (plan §Open
  Decision) and unify these stores; plan Step 3 is written around that decision.
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

## Provider configuration model

A provider entry carries:

| Field | Example (DeepSeek) | Notes |
|---|---|---|
| `id` | `deepseek` | stable key |
| `label` | `DeepSeek` | UI display name |
| `baseUrl` | `https://api.deepseek.com/v1` | **contract: must include the API prefix up to (but not including) the endpoint path; client appends `/chat/completions`.** For OpenAI/Ollama/vLLM-style servers this is `…/v1`; DeepSeek today is `…/v1`. |
| `endpointPath` | `/chat/completions` | default; overridable for oddballs (Azure) |
| `authScheme` | `bearer` | `bearer` \| `none` (vLLM/Ollama without auth). No `custom` value — `bearer` + `headers` covers the rest. `query` was dropped (Azure deferred, §2.9). |
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
| `maxResponseTokens` | — | optional cap on accumulated response; global safety constant (e.g. 100K) applies if unset (see §2.9) |

Config lives in a single backend module (`providers.ts` + `providerRegistry`,
**code-registry for the near-term, not DB** — see plan §Open Decision).

## Env-var override contract (self-hosting escape hatch)

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

## Pricing freshness (staleness detection)

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

## Risks & edge cases (must address, not copy)

### 2.1 Per-provider `max_tokens` / model capabilities
`max_tokens: 8000` is hardcoded (deepseekService.ts:729/805). Many providers/models
cap lower (local Ollama models, some OpenAI models) → silent truncation or 400s.
Provider entry carries optional `maxTokens`; absent → 8000 default.

### 2.2 SSE streaming parsing is brittle (bug exists today — fix, not copy)
Current parser (deepseekService.ts:837-862) assumes one `data:` line per chunk
boundary. Real issues:
- A single SSE event can span two `read()` chunks and the current per-read
  `chunk.split('\n')` **silently truncates** the partial line — everything after
  the last `\n` in a chunk that doesn't end with one is discarded, causing
  intermittent stream corruption.
- The **final read is dropped entirely**: the loop `break`s on `done`
  (deepseekService.ts:834) *before* decoding `value` (:836), so a complete
  `data:` line arriving in the last chunk is lost.
- `[DONE]` at :842 is `continue`, not `break` — data lines after the terminal
  marker in the same chunk would still be processed.
- Providers may emit `delta.role`, `finish_reason`, or `delta.text` instead of
  `delta.content`.
Fix with a frame buffer (`delta.content ?? delta.text` normalization, decode the
final `value`/`decoder.flush()`, process post-loop remainder, `break` on `[DONE]`,
cap `fullContent` growth) — plan Step 1.

### 2.3 Token/cost accounting differs by provider
The live streaming path **never reads real `usage`** — it estimates output tokens
from content (deepseekService.ts:870). Non-streaming `analyzeFiles` does read
`usage`. With provider-aware pricing, estimates become the only numbers users see.
Decision: capture streaming `usage` where supported (DeepSeek/OpenAI emit it at
`[DONE]` with `stream_options: { include_usage: true }`), and **explicitly
document estimate-only accounting** for providers that never return usage (Ollama).
Provider `streamingUsage` flag drives this.

### 2.4 `calculateCost` breaking change
See plan Step 2. All 8 backend call sites updated in one commit; no silent
DeepSeek-pricing fallback.

### 2.5 Header / auth differences within "OpenAI-compatible"
The umbrella is looser than it looks: OpenRouter wants `HTTP-Referer`/`X-Title`
headers; Ollama may send no auth and no `usage`; vLLM serves whatever model is
loaded. The provider entry's `authScheme` (`bearer`|`none`) + optional static
`headers` covers these with ~20 lines. **`bearer` + custom `headers` is
sufficient — no `authScheme: 'custom'` value needed** (review §4.4). **Azure is
explicitly deferred to follow-up** (§2.9): it needs a URL template
(`/deployments/{deployment-name}/chat/completions`), `api-version` query-param
handling, and key-to-query mapping — fields the config model doesn't have
(`urlTemplate`/`queryParams`), so it's not a near-term candidate.

### 2.6 Key fallback
See plan Step 3 matrix. No cross-provider key reuse, ever.

### 2.7 `baseUrl` + path contract
Defined in the config table: `baseUrl` includes the API prefix (`/v1`), client
appends `/chat/completions` (or `endpointPath`). This contract is the difference
between the "generic base URL" win working and not.

### 2.8 Error messages
Parameterized by provider label, classified per provider (status + body shape,
not one status check), with a fallback for unrecognized shapes (plan Step 1).

### 2.9 Other production gaps surfaced by review
- **No upstream timeout** today — a hung provider holds the SSE connection open
  forever. Add ~120s timeout → `PROVIDER_TIMEOUT` (plan Step 1).
- **No response-size limit** — `fullContent` grows unbounded in memory. Add a
  cap → `RESPONSE_TOO_LARGE` (plan Step 1).
- **Heartbeat lifecycle** — `setInterval` (analysisController.ts:53) is cleared
  only in `finally` (:81); if abort propagation is swallowed, it fires on a dead
  response. Clear it in `req.on('close')` directly (plan Step 1).
- **Concurrency** — service must stay stateless; registry read-only after init so
  simultaneous requests with different keys don't cross-contaminate (plan Step 1).
- **Existing `analyses` rows** — new `provider`/`model`/`cost_basis` columns are
  `NULL` for historical rows; backfill to DeepSeek/estimated, UI shows
  "Unknown provider" only defensively (plan Step 6).

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
- **Self-hosted/local**: **vLLM**, **Ollama**, **LM Studio** — OpenAI-compatible
  `/v1/chat/completions`; enables local/offline/proxy use with zero protocol code.
  Caveats: auth may be `none`, `usage` may be absent.
- **Azure OpenAI** — **deferred to follow-up** (not a near-term candidate): needs
  `/deployments/{name}/chat/completions` URL templating + `api-version`
  query-param handling, which the current config model doesn't have (§2.5/§2.9).

## Follow-up scope (broader expansion — track in TO_DO, not part of this plan)

Providers with non-OpenAI protocols need a request/response **adapter** layer, not
just config:

- **Anthropic** — Messages API (different endpoint shape, `x-api-key` header,
  `thinking` blocks).
- **Google Gemini** — `generativelanguage.googleapis.com` REST API.
- **AWS Bedrock** — SigV4 auth + per-model protocol variants.
- **Azure OpenAI** — OpenAI-compatible but needs `urlTemplate`
  (`/deployments/{name}/chat/completions`) + `queryParams` (`api-version`) fields
  in the config model before it fits (§2.5).
- **Cohere**, **xAI** (OpenAI-compatible today but verify), others.

The `ProviderClient` interface from the near-term work (returning normalized
`{issues, inputTokens, outputTokens}`) should be designed so these slot in later
without reworking the analysis pipeline.