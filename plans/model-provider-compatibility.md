# Plan: Model / Provider Compatibility

> **Status: NEEDS REVIEW** — draft, not yet approved. Written 2026-08-19.
> **Revision 7:** four review rounds incorporated; **all open decisions resolved**
> (§Open decisions) — nothing blocks implementation.
> Scope confirmed: **OpenAI-compatible APIs only**; everything else is follow-up
> behind an adapter abstraction.
>
> **Companion doc:** `model-provider-compatibility-research.md` holds the verified
> current-state analysis, provider config model, env-var contract, pricing
> freshness design, risks/edge cases, and candidate-provider research. This file
> is the actionable plan; the companion is the evidence it stands on.

**Repo:** codevibes-next (Vite/React/TS frontend + `codevibes-backend` Express/TS)

**Current state (summary — details in companion doc):** backend is hardcoded to
DeepSeek (`deepseekService.ts`, `tokenCounter.ts` pricing); the analyze path takes
the key from `req.body` via two divergent client stores; the frontend hardcodes
DeepSeek branding and pricing in several places. The GitHub side (file selection,
priority categorization) is provider-agnostic already.

---

## Proposed scope for the near-term work

**Support providers that expose an OpenAI-compatible chat-completions API**, since
DeepSeek already uses that shape and zero protocol translation is needed. The work
is: make provider config (base URL, model, auth, pricing) dynamic, expose it in the
API + UI, and keep DeepSeek as the default.

---

## Implementation steps (with acceptance criteria)

> **Blockers:** none remain — the §Open decisions that used to gate Step 3 (key
> source of truth + `validateApiKey`/`analyzeFiles`/snippet-path fates) were
> resolved in Rev 6. Steps proceed in order; Steps 1+2 remain atomic (Step 1 note).

### Step 1 — Extract a generic OpenAI-compatible client

Refactor `deepseekService.ts` into an `aiProvider.ts` client:
`chatCompletions(files, apiKey, priority, provider)` + `streamAnalysis(…)` with the
same signature plus `provider`. Keep priority prompts, file formatting, JSON
extraction untouched (they're provider-agnostic). Update `types/index.ts`
(`AnalyzeRequest` gains `provider`/`model`), `analysisController.ts`,
`analysisService.ts`.

> **Step ordering note (review §2.1):** Step 1's `streamAnalysis` calls
> `calculateCost` (deepseekService.ts:871). Do **not** land Step 1 alone with the
> old 2-arg signature — broken intermediate state. Steps 1+2 are atomic: Step 1
> uses the **new** `calculateCost` signature from the start, backed by a
> temporary hardcoded DeepSeek provider object until the registry lands in
> Step 2.
>
> **Legacy preservation (from review E1 — the plan's most important runtime-safety
> property):** `deepseekService.streamAnalysis` (and its SSE parser) must remain
> **byte-for-byte intact** through Step 1 — the `USE_LEGACY_PROVIDER` rollback
> flag (Step 5) depends on it. "Refactor into `aiProvider.ts`" means *add* the new
> client alongside the old file, not delete it. Only the new path gets the fixes;
> the legacy path stays untouched until the flag is removed.

**Also in this step (small, easy to miss):**
- Parameterize all error messages by provider label — today they throw
  `'Invalid DeepSeek API key'` / `'DeepSeek rate limit exceeded'` /
  `'DeepSeek API error'` (deepseekService.ts:738/741/743/814/817/819). After the
  refactor an OpenAI/Groq user must not see "DeepSeek" in errors.
- **Replace string-sniffed error routing with typed error codes** —
  `analysisService.ts:221-224` routes errors via `error.message.includes('API
  key')` / `.includes('rate limit')`. Throw a typed error carrying `code:
  'INVALID_API_KEY' | 'RATE_LIMITED'` and route on the code. **Per-provider
  classification (review §1.5):** providers differ in *how* they signal these —
  OpenAI 401/429, Groq same statuses different JSON, Ollama/vLLM maybe none. Add
  per-provider `classifyError(status, body)` with a documented fallback for
  unrecognized shapes (log raw body, surface `PROVIDER_ERROR`). **Contract
  (review R1):** `classifyError(status: number, bodyText: string):
  ProviderErrorCode` — takes raw body text, tries `JSON.parse`, falls back to
  string matching; providers may supply a custom impl or use the default.
- **Fix the SSE frame-buffer bug** (see §2.2 in companion): accumulate raw bytes
  and split on `\n` only at frame boundaries (carry a partial line across reads),
  instead of the current per-read `chunk.split('\n')` which **silently truncates**
  partial `data:` lines. **Three tail cases:**
  (a) **the final read is dropped today** — the loop `break`s on `done`
  (deepseekService.ts:834) *before* decoding `value` (:836); decode the final
  `value` or rely on `decoder.flush()`; test "complete `data:` line in the final
  chunk, no trailing `\n`"; (b) call `decoder.flush()` on `done` (multi-byte char
  straddling the final read); (c) process any carried remainder after the loop
  ends, not only inside it. **`[DONE]` must `break`, not `continue`** (:842).
- Normalize `delta.content ?? delta.text` for providers that emit `delta.text`.
- **Upstream request timeout:** today there is none — a hung provider keeps the
  SSE connection open forever. Add a timeout (e.g. 120s) on the upstream fetch,
  surfaced as a typed `PROVIDER_TIMEOUT` error. (Timeout fires the same
  `AbortController` as the disconnect path below.)
- **Response size cap:** `fullContent` accumulates unbounded in memory today. Add
  a safety cap (provider `maxResponseTokens` or a module constant, e.g. 100K
  tokens) that stops accumulation and yields a typed `RESPONSE_TOO_LARGE` error
  rather than OOM-ing. **Check the cap mid-stream (from review R2):** verify the
  running total after **each chunk's content is appended**, and abort the read
  loop immediately when it trips — don't buffer 200K tokens and check at the end.
- **Abort upstream on client disconnect + clear the heartbeat in the close
  handler** — `analysisController.ts:48-50` logs `req.on('close')` but the fetch
  runs to completion (analysisService.ts:163), burning a paid call. Wire
  `AbortController`/`signal` from the controller through `streamAnalysis` to the
  upstream fetch; on abort, release the reader lock and stop. **Do not rely on
  abort reaching the controller's `finally`** (`clearInterval` only at
  analysisController.ts:81): clear the interval **directly in the
  `req.on('close')` handler** (first line, before any await) and keep it in
  `finally` as belt-and-suspenders (`!res.writableEnded` guard covers a queued
  callback).
- **Metered-usage capture (from review F3 — closes the `cost_basis` build gap):**
  the streaming path today neither requests nor reads `usage` (body at
  deepseekService.ts:722-730 has no `stream_options`; parser reads only
  `delta.content`/`reasoning_content`; `usage` is read only in the non-streaming
  path that Step 3 deletes). Add to `streamAnalysis`: send
  `stream_options: { include_usage: true }`; parse `usage` from the **final
  chunk** (before `[DONE]`; may arrive with empty `choices`); when present emit
  `costBasis: 'metered'` with real token counts, else `'estimated'` per the
  provider's `streamingUsage` flag. Test both shapes.
- **Network/transport errors (from review E3):** `fetch` can throw before any
  HTTP status (DNS failure, connection refused, dead `AI_BASE_URL`). Route
  fetch-throws and non-JSON error bodies to a typed `PROVIDER_UNREACHABLE`, not
  `UNEXPECTED_ERROR` via the parser's catch.
- **URL concatenation contract (from review E2):** `baseUrl` has **no trailing
  slash** and includes the API prefix (`/v1`); `endpointPath` **starts with
  `/`** (default `/chat/completions`; vLLM-style hosts put `/v1` in the
  `endpointPath` instead). Concatenate as `baseUrl + endpointPath`; tests assert
  no `//` and correct `/v1` handling for both placements.
- **Concurrency (review §3.6):** the current service is stateless — each call
  creates its own fetch. Preserve in `aiProvider.ts`: the registry is a
  module-level singleton, **read-only** after init (no per-request mutation), so
  simultaneous requests with different keys/models can't cross-contaminate.

**Done when:** `streamAnalysis` streams identically against DeepSeek with the same
prompts/parse behavior; error strings interpolate provider label; error routing
uses typed codes with per-provider classification (incl. fetch-throw →
`PROVIDER_UNREACHABLE`); SSE parser passes the new buffer-split + tail +
final-read + post-`[DONE]` + final-chunk-`usage` tests (Testing strategy); client
disconnect aborts the upstream fetch within a bounded time and the heartbeat stops
in the close handler; upstream timeout, response cap, and metered/estimated
`costBasis` are typed and tested; `baseUrl`+`endpointPath` concat never produces
`//`; legacy `deepseekService.streamAnalysis` unchanged.

### Step 2 — Provider registry + pricing

Add `providers.ts` with DeepSeek as default; move pricing into provider entries
(config model in companion doc). `calculateCost` **changes signature** to
`calculateCost(inputTokens, outputTokens, inputCostPerMillion, outputCostPerMillion)`
— a **deliberate breaking change across 8 backend call sites** (analysisService.ts
×5, deepseekService.ts ×2, tokenCounter.ts `getFullEstimate` ×1) **plus 3
frontend sites** that re-hardcode `(tokens/1e6) * 0.14`: `AnalyzePage.tsx:391`
(cost persisted via `saveAnalysis`), `AnalyzePage.tsx:1042` (live display),
`ResultsPage.tsx:162` (history display). Update all backend call sites in one
commit; no default that silently falls back to DeepSeek pricing. **The frontend
must stop computing cost itself** — the `complete` SSE event already carries
server-computed `cost`/`tokensUsed`; the three display/persist sites consume that
(extended per Step 6 with `provider`, `model`, `pricingStatus`) — single source
of truth.

**Done when:** every backend call site passes provider costs; a unit test asserts
non-DeepSeek pricing produces expected numbers and that no call site compiles with
the old arity (typecheck); the 3 frontend pricing sites render/persist the
server-computed cost and contain no `0.14` literal.

> **Deploy order for the breaking change (from review §1.4):** the new `complete`
> event shape (provider-aware `cost` + new `provider`/`model`/`pricingStatus`
> fields) must ship **backend-first, frontend-second**. An old tab with stale JS
> still computing `(tokens/1e6) * 0.14` will show *both* its local number and the
> server value — so the frontend deploy must (a) happen after the backend deploy
> and (b) tolerate the old shape (treat missing `provider`/`model`/`pricingStatus`
> as "DeepSeek, pricing unknown"). No new-frontend-on-old-backend window.
> Wording nit from review §2.3: the "8 + 3" count is **8 backend `calculateCost`
> call sites** (analysisService.ts ×5, deepseekService.ts ×2, tokenCounter.ts ×1)
> **plus 3 frontend sites that hardcode the pricing formula** — the frontend sites
> do *not* call `calculateCost`; they are 3 separate hardcoded `(tokens/1e6) * 0.14`
> literals that must be deleted, not re-pointed.
> **Inventory verified (review E5):** tokenCounter.ts:68 sits *inside*
> `getFullEstimate`, so the ×1 count covers it — no hidden site. CI already runs
> `npm run typecheck` (`tsc --noEmit`, both packages) as a hard quality job, which
> is the real guard against missed call sites; keep it in the same PR.

### Step 3 — API keys: unify client stores, then per-provider keys

**Key source of truth (resolved — request-body keys):** the analyze path takes
the key from `req.body` today via **two divergent client stores**
(`codevibes-storage` zustand for `AnalyzePage`, `vibeguard_deepseek_api_key`
localStorage for the snippet path) + a write-only DB column + a dead
`PUT /api/auth/deepseek-key`. **Decision: keep request-body keys** — client sends
the key for the selected provider, server uses it. No server-side resolution or
decryption in the hot loop. Consequences (all resolved):

1. **Unify the client stores** — one key store (provider + key + model) consumed
   by `AnalyzePage`; migrate `vibeguard_deepseek_api_key` readers/writers to it.
   `SetupPage` and `SettingsModal` write to the same store.
2. **Delete the dead endpoint + the write-only column (resolved):** `PUT
   /api/auth/deepseek-key` is never invoked from the client. **Full checklist
   (all `deepseek_key` sites, review E8/E9, verified):** route +
   `authController.saveDeepSeekKey`; client `saveDeepSeekKey` (api.ts:293);
   `/me` response (authController.ts:141 destructure, :146 `hasDeepseekKey`);
   column (database.ts:36) + INSERT/encrypt (:151-152, :156-157) + `updateUser`
   (:168); decrypt calls (:134/:144) + `decryptTokenField` type union (:113)
   narrows to `'github_token'`. Update `ApiReferencePage` too — no docs
   describing a deleted API.
3. **Key fallback matrix (no cross-provider reuse):** user selects provider X →
   use the client-stored key for X; missing → "add a key for X" error. **Never**
   reuse another provider's key (a user's DeepSeek key must not be silently sent
   to a third party). Env-var `AI_BASE_URL` self-hosters: key may come from
   `AI_API_KEY` env var as a deliberate override (documented).

**Also (fates resolved):**
- **`validateApiKey()` — wire, don't drop:** it's dead today (deepseekService.ts:885,
  never imported). Wire it into the Settings modal "test key" flow (Step 4),
  made provider-aware (per-provider endpoint + `classifyError`). Low effort, real
  UX value; dead exported code is a liability.
- **`analyzeFiles()` — delete:** unused in production; keeping it means
  maintaining a second provider-coupled entrypoint forever. If a non-streaming
  path is ever needed, build it on the new `aiProvider.ts` — don't carry the old
  one forward. Reduces Step 1's refactor surface.
- **Snippet path — delete (product cut, not just hygiene):** `Index.tsx` is the
  home page — a visible "paste your Git diff" analyzer whose live call
  **deterministically errors** today (`parseGitHubUrl('code-snippet')` → null →
  `INVALID_URL`). Fixing it *and* threading provider support is double work for a
  broken feature. Remove `useAnalysis`, the `repoUrl: 'code-snippet'` call, and
  the DropZone analyze wiring. **Scope verified (review F1 — rejected):** only
  `Index.tsx` imports the `useAnalysis` hook; the 5 other `useAnalysis*`-matching
  files import `useAnalysisStore` (GitHub-repo store, stays). **Keep
  `useHistory`** and the home page. Frame the removal as a product cut in the PR.
- **Never log the API key (from review Q5):** the refactor touches the full
  request path; add an acceptance guard that no log statement includes `apiKey`
  (current logging — analysisController.ts:60 `hasToken`, analysisService.ts:219
  `repoUrl`/`priority` — logs only booleans/URLs; preserve that).

**Done when:** one client key store serves `AnalyzePage`; the dead endpoint,
`saveDeepSeekKey`, `/me` `hasDeepseekKey`, and every `deepseek_key` DB site
(column, INSERT/encrypt, `updateUser`, `decryptTokenField` union) are gone (with
`ApiReferencePage` updated); fallback matrix covered by tests; `validateApiKey`
wired into Settings "test key" and provider-aware; `analyzeFiles` and the
snippet-analyze path removed; no log statement contains `apiKey`; existing stored
DeepSeek keys still load after the store migration.

### Step 4 — Frontend settings + full DeepSeek-brand surface

Generalize `SettingsModal.tsx` + `api.ts` (`saveDeepSeekKey` → per-provider save)
into a provider picker: provider dropdown, model selector, key field, "get key"
link, and a "test key" button that calls the wired `validateApiKey`. **The model
selector's options come from the provider's `models` list in the registry — the
*same* source the server validates against (Step 5), never a separate hardcoded
list (review Q6).** Persist chosen provider + key. Cost estimates show which
provider and pricing they assume.

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
- **Wiring (from review E4 — otherwise a silent DeepSeek-always regression):**
  thread `provider`/`model` through the whole chain: controller destructures them
  from `req.body` → `analyzeRepository(repoUrl, apiKey, priority, provider, model,
  githubToken)` → `streamAnalysis(files, apiKey, priority, provider, model)`.
  Step 1's acceptance includes this end-to-end path.
- **`GET /estimate` contract (from review §3.3 — resolved):** the endpoint takes
  no API key (it estimates tokens from the GitHub tree, never calls the AI
  provider) and should stay that way. It gains a `provider` (default `deepseek`)
  query param and returns **token counts + the provider's pricing metadata**
  (`inputCostPerMillion`/`outputCostPerMillion`/`pricingStatus`) so the frontend
  renders an estimated cost from server-provided pricing — a deliberate exception
  to "server computes cost", since there's no stream and no `complete` event here.
  It must **not** take the user's API key, and the frontend must not multiply by a
  hardcoded rate. **Frontend wiring site (review E6):** `getEstimate` (api.ts:107),
  consumed at AnalyzePage.tsx:143 — it gains the `provider` query param and reads
  the pricing metadata from the response.
- README/setup: document provider picker, per-provider keys, and the env-var
  contract (companion doc) for self-hosters.
- API docs for the changed key endpoint and new `AnalyzeRequest.provider`/`model`
  fields.
- Release gate (manual, demoted from being the only verification): validate against
  at least one second real provider from the candidate list (companion doc).
- **Rollback/feature-flag strategy (from review §2.4, scoped per R3/E1):** the
  first deploy keeps env flag `USE_LEGACY_PROVIDER=true` (default off), checked
  **only in `analysisService.analyzeRepository`** — the *entire* analyze call
  routes to the untouched `deepseekService.streamAnalysis` path (byte-for-byte
  intact per Step 1's legacy-preservation note), not just provider selection.
  **The flag is read per-request** — an intentional exception to the import-time
  `AI_*` rule so it flips without restart; comment this so nobody "fixes" it.
  Removed once the new path runs clean in production for a few days.
- **PR/branch strategy (from review Q4):** Steps 1+2 land together (atomic) behind
  `USE_LEGACY_PROVIDER`; Step 3 in a follow-up PR after the backend deploy; Steps
  4-6 in subsequent PRs. This preserves the backend-first deploy contract from
  Step 2's deploy-order note.

**Done when:** invalid provider/model rejected with 400 + valid lists; provider/
model threaded end-to-end (controller → `analyzeRepository` → `streamAnalysis`);
`GET /estimate` honors `provider` and returns pricing metadata (no key required),
and the frontend estimate call (AnalyzePage.tsx:143) passes/reads it; docs
updated; tests green (Testing strategy); one second provider validated and
recorded; `USE_LEGACY_PROVIDER` rollback flag in place (per-request).

### Step 6 — Pricing freshness: CI check + UI flags + history schema

- Add `scripts/check-pricing.mjs` (runnable locally + in CI) implementing the
  pricing-freshness logic from the companion doc: machine-readable diff for
  OpenRouter, staleness check (`pricingAsOf` age vs
  `PRICING_STALE_AFTER_DAYS` — **default 90, env-configurable**, documented in
  README with the env-var contract) for all providers, clear exit codes/messages.
- Add `pricing-check.yml` cron (**monthly, or configurable per provider — weekly
  is too frequent for page-only providers**, review §4.3). **On drift
  (resolved):** **auto-PR** updating pricing + `pricingAsOf` for machine-diffable
  providers (OpenRouter); **issue** for staleness-only findings on page-only
  providers (DeepSeek, OpenAI). Informational, not merge gates; workflow needs
  `contents: write` + `pull-requests: write` for the auto-PR path.
- Backend: expose `pricingStatus` (`current` | `stale` | `unknown`) + `pricingAsOf`
  per provider in the estimate/complete payloads (from the registry, cheap — no
  network).
- **Persist provider/model in the `analyses` row** (database.ts:42-57 has
  `cost`/`tokens_used` but no provider/model), so history rows stay unambiguous
  ("$0.82 on DeepSeek" vs "on OpenRouter") — add `provider`, `model`, and a
  cost-basis flag (`metered` | `estimated`) columns, following the repo's informal
  migration pattern (`CREATE TABLE IF NOT EXISTS` + `try { ALTER TABLE } catch`,
  database.ts:64-71). `saveAnalysis` + history display (`ResultsPage`) surface
  them. **Backfill (from review §3.4, ordered per R4, basis per E7):** existing
  rows get `NULL` for the new columns. The `ALTER TABLE` (in the informal
  `try/catch` migration) and the backfill **`UPDATE` must be separate
  statements** — on a large history table the UPDATE can lock it, so don't run
  it inline in the same try/catch; run it as a distinct statement after the
  schema change (manually or a background step). Backfill value:
  `provider='deepseek'`, `model='deepseek-chat'`, `cost_basis='estimated'`
  `WHERE ... IS NULL` — **`estimated` is accurate here, not a compromise:** the
  streaming path never captured real `usage` (verified — `usage` was read only in
  the non-streaming path), so every historical `cost` value is a token-count
  estimate. The UI renders "Unknown provider" only if a row still has `NULL`
  (defensive).
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

## Testing strategy

Test runner is **Vitest** (root `npm test`; backend `npm --prefix
codevibes-backend run test`). CI is enforced, not advisory: `.github/workflows/ci.yml`
has a `quality` job (lint + typecheck + file-size check), a `test` job
(`vitest run --coverage` for both packages), a `build` job, and a `security` job
(gitleaks + semgrep). Existing harness: `utils/encryption.test.ts`,
`utils/fileFilter.test.ts`; new files e.g. `services/aiProvider.test.ts`,
`utils/tokenCounter.test.ts`.

Unit tests (mandatory before merge):

- **SSE parser** (highest ROI — encodes the §2.2 bug fix from the companion doc):
  (a) `data:` event split across two `read()` chunks, (b) multiple events per
  chunk, (c) `reasoning_content` vs `content`, (d) `delta.text` shape, (e)
  `[DONE]`, (f) malformed/partial JSON, (g) **multi-byte char straddling the final
  read** (decoder flush), (h) **final `data:` line arriving without a trailing
  `\n` in the last `read()`** (the dropped-final-value case — a complete event in
  the final chunk must not be lost), (i) **data lines after `[DONE]` in the same
  chunk are ignored** (break, not continue), (j) **final chunk carrying `usage`
  with empty `choices`** (metered capture — emits `costBasis: 'metered'`), (k)
  **no-usage provider** (falls back to `'estimated'`).
- **`parseIssuesFromResponse`**: markdown-wrapped JSON, empty `issues`, missing
  `category`/`severity` normalization, `undefined` line.
- **`calculateCost` / provider pricing**: per-provider numbers; asserts the new
  signature has no DeepSeek-default fallback.
- **Error classification**: per-provider `classifyError` — OpenAI 401/429 shapes,
  Groq different body shapes, **OpenRouter's envelope (`error.message`/
  `error.code`)**, **non-JSON body**, **fetch-throw/network failure →
  `PROVIDER_UNREACHABLE`**, unrecognized shape falls back to `PROVIDER_ERROR`
  (Step 1).
- **Provider registry**: DeepSeek default resolution, env-override precedence
  (companion doc), unknown-provider handling, **`baseUrl`+`endpointPath`
  concatenation (no trailing slash / no `//` / `/v1` in base vs path)**, **env
  values read at import time vs per-request** (see Open Decision — tests must not
  race module init; `USE_LEGACY_PROVIDER` is the documented per-request
  exception), **registry read-only after init** (concurrency).
- **Pricing freshness**: `current`/`stale`/`unknown` derivation (threshold
  boundary, missing `pricingAsOf`, env-override custom provider), and
  `check-pricing.mjs` behavior for both machine-diffable (OpenRouter) and
  page-only (DeepSeek) sources.
- **Abort + timeout paths**: client disconnect mid-stream → upstream fetch aborted
  and reader released; hung provider → `PROVIDER_TIMEOUT` (Step 1).
- **Controller validation**: unknown `provider`/`model` → 400 with valid lists;
  `GET /estimate` honors `provider` and returns pricing metadata (Step 5).

Integration tests (recommended): mocked OpenAI-compatible SSE endpoint (local stub
or `nock`) asserting the normalized `{issues, inputTokens, outputTokens, cost}`
shape — makes second-provider support claimable without a paid account. Key
source-of-truth/fallback matrix (Step 3) incl. the unified client store.

Manual validation: keep the Step 5 release-gate check against one real second
provider — as a release gate, not the sole verification.

---

## Docs to update

- README/setup: env-var contract + provider picker (self-hosters).
- `aiProvider.ts` header comment: the OpenAI-compatible contract + the adapter
  boundary future non-OpenAI providers must implement.
- API docs: removed key endpoint (`ApiReferencePage`), new
  `AnalyzeRequest.provider`/`model` fields.
- Link from the "explore how codevibes works" TO_DO doc to this plan.

---

## Open decisions (all resolved 2026-08-19, Rev 6)

Decision record — decision + one-line rationale. Nothing blocks implementation.

- [x] **Scope: OpenAI-compatible only.** Multi-protocol now roughly doubles scope
      for no near-term gain; `ProviderClient` interface keeps the adapter open.
- [x] **Provider config: code registry.** DB config later only for runtime
      editing; migration = `providers` table seeded from the registry.
- [x] **Azure: defer.** Needs `urlTemplate`/`queryParams` fields + subscription
      to test; `authScheme` stays `bearer`|`none` (bearer + `headers` covers
      OpenRouter — no `custom`).
- [x] **Key source of truth: request-body keys.** Matches today's flow; no
      server-side resolution or decryption in the hot loop; HTTPS body unchanged.
- [x] **Dead key endpoint + column: delete** (all sites listed in Step 3),
      `ApiReferencePage` updated. Clean addition later if users want server keys.
- [x] **Per-provider key storage shape: moot (deferred).** No server-side keys;
      `provider_keys` JSON column if ever needed.
- [x] **`validateApiKey`: wire into Settings "test key".** One call + button +
      toast; dead exported code is a liability.
- [x] **`analyzeFiles`: delete.** Unused; second provider-coupled entrypoint.
- [x] **Snippet path: delete (product cut).** Deterministically errors today;
      keep `useHistory`/home page (hook importers verified — only `Index.tsx`).
- [x] **Env read timing: import-time.** Matches `deepseekService.ts:17`; immutable
      registry; testable via `vi.resetModules()`. **Exception: `USE_LEGACY_PROVIDER`
      is per-request** so it's flippable without restart.
- [x] **Streaming `usage`: implement `include_usage: true`** (Step 1 sub-item +
      tests). Metered vs estimated differs 10-30%.
- [x] **Staleness threshold: 90 days, env-configurable**
      (`PRICING_STALE_AFTER_DAYS`).
- [x] **CI drift: auto-PR (machine-diffable) + issue (page-only).** Informational,
      not merge gates.
- [x] **Live pricing (OpenRouter runtime): defer to follow-up.** Registry + flags
      + CI covers ~95% of the value.
- [x] **Second validation provider: OpenRouter.** One key, many models, exercises
      `headers` + CI pricing check; Ollama's no-auth/no-usage path is a separate
      mocked/local integration test.
- [x] **`GET /estimate`: token-only + pricing metadata, no key** (wiring:
      `getEstimate` api.ts:107 → AnalyzePage.tsx:143).

## Related work

- TO_DO item: explore and document how codevibes works (file selection + reviewing
  agent instructions) — the doc it produces should reference this plan.
- `fileFilter.ts` / `githubService.ts` are provider-agnostic; no changes expected
  there.

---

## Revision log

- **Rev 7 (2026-08-19):** round-4 review (13:22 file). Fixed the real gaps: Step 1
  now schedules **metered-usage capture** (`stream_options: { include_usage: true }`
  + final-chunk `usage` parsing + `costBasis` wiring — the build path F3 said was
  missing); legacy `deepseekService.streamAnalysis` **preserved byte-for-byte**
  through Step 1 and `USE_LEGACY_PROVIDER` read **per-request** (explicit exception
  to the import-time `AI_*` rule); URL concat contract specified (no trailing
  slash, `/v1` placement) + test; `classifyError` extended with OpenRouter's
  envelope and fetch-throw → `PROVIDER_UNREACHABLE`; explicit
  controller→`analyzeRepository`→`streamAnalysis` provider/model wiring; deletion
  checklist expanded to all `deepseek_key` sites (`/me` response authController:141,
  INSERT/encrypt database:151-168, `decryptTokenField` union :113); estimate wiring
  site named (`getEstimate` api.ts:107 → AnalyzePage.tsx:143); backfill rationale
  documented (historical costs were estimates — streaming never read usage); PR
  strategy stated; no-`apiKey`-in-logs guard added; `models` single source
  (registry). **F1/F2 rejected with evidence** — only `Index.tsx` imports the
  `useAnalysis` hook (5 other files import `useAnalysisStore`, which stays), and
  the docs contain no `client/` paths (verified by grep).
- **Rev 1-6 (2026-08-19):** same-day iterative hardening across three review
  rounds (key-flow premise, SSE parser fixes, typed errors, pricing freshness,
  deploy order, rollback flag, backfill, decision resolution). Detail in git
  history (`git log plans/model-provider-compatibility.md`); Rev 6 resolved all
  open decisions.