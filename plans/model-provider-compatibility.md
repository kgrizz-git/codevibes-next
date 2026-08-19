# Plan: Model / Provider Compatibility

> **Status: NEEDS REVIEW** — draft, not yet approved. Written 2026-08-19.
> **Revision 6:** three external review rounds incorporated and **all open
> decisions resolved** (see §Open decisions) — no decisions remain that block
> implementation.
> Scope confirmed: near-term work focuses on **OpenAI-compatible APIs only**;
> everything else is tracked as follow-up work behind an adapter abstraction.
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

> **Blockers:** none remain — the §Open decisions that used to gate Step 3
> (key source of truth + `validateApiKey`/`analyzeFiles`/snippet-path fates) were
> resolved in Rev 6. Steps can proceed in order; Steps 1+2 remain atomic (see
> Step 1 ordering note).

### Step 1 — Extract a generic OpenAI-compatible client

Refactor `deepseekService.ts` into an `aiProvider.ts` client:
`chatCompletions(files, apiKey, priority, provider)` + `streamAnalysis(…)` with the
same signature plus `provider`. Keep priority prompts, file formatting, JSON
extraction untouched (they're provider-agnostic). Update `types/index.ts`
(`AnalyzeRequest` gains `provider`/`model`), `analysisController.ts`,
`analysisService.ts`.

> **Step ordering note (from review §2.1):** Step 1's `streamAnalysis` calls
> `calculateCost` (deepseekService.ts:871). Do **not** land Step 1 alone with the
> old 2-arg signature and then change it in Step 2 — that's a broken intermediate
> state. Steps 1+2 are atomic: Step 1 must use the **new** `calculateCost`
> signature from the start, backed by a temporary hardcoded DeepSeek provider
> object until the registry lands in Step 2.

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
  code. **Per-provider error classification (from review §1.5):** providers
  differ in *how* they signal these conditions — OpenAI returns 401/429,
  Groq 401/429 with different JSON shapes, Ollama/vLLM may return none. Don't
  assume one `response.status` check classifies every provider: add a
  per-provider `classifyError(status, body)` mapping with a documented
  fallback for unrecognized shapes (log the raw body, surface
  `PROVIDER_ERROR`). Typed codes must be *correct per provider*, not just
  renamed string-sniffing. **Contract (from review R1, resolved):**
  `classifyError(status: number, bodyText: string): ProviderErrorCode` — takes
  the **raw body text**, tries `JSON.parse` internally and falls back to string
  matching; provider entries may supply a custom implementation or use the
  default.
- **Fix the SSE frame-buffer bug** (see §2.2 in companion): accumulate raw bytes
  and split on `\n` only at frame boundaries (carry a partial line across
  `read()` chunks), instead of the current per-read `chunk.split('\n')` which
  **silently truncates** partial `data:` lines that straddle reads. **Three tail
  cases included:**
  (a) **the final read is dropped today** — the loop `break`s on `done` at
  deepseekService.ts:834 *before* decoding `value` at :836, so a complete
  `data:` line arriving in the last chunk is lost. Decode the final `value`
  before breaking, or rely on `decoder.flush()` to return it — add a test for
  "final chunk contains a complete `data:` line with no trailing `\n`";
  (b) call `decoder.flush()` once `done` is seen (a multi-byte char can straddle
  the final read); (c) process any carried remainder after the read loop ends,
  not only inside it.
  **`[DONE]` must stop the stream:** today it's `continue` (:842), which keeps
  processing trailing lines in the same chunk if a provider sends data after
  `[DONE]` — change to `break`/flag.
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
  handler** — `analysisController.ts:48-50` already logs `req.on('close')` but
  the fetch runs to completion (analysisService.ts:163), burning a full paid call
  for users who close the tab. Wire `AbortController`/`signal` from the
  controller through `streamAnalysis` to the upstream fetch; on abort, release
  the reader lock and stop. **Do not rely on the abort reaching the controller's
  `finally` to clean up the heartbeat** (`clearInterval` lives only at
  analysisController.ts:81): if the abort surfaces as an exception caught and
  re-thrown inside `analyzeRepository`, the 15s heartbeat keeps firing on a dead
  response. Clear the interval **directly in the `req.on('close')` handler**, and
  keep it in `finally` as belt-and-suspenders.
- **Concurrency (from review §3.6):** the current service is stateless — each
  call creates its own fetch. Preserve this in `aiProvider.ts`: the provider
  registry is a module-level singleton and must be **read-only** after init
  (no mutation per-request), so simultaneous requests with different keys/models
  can't cross-contaminate.

**Done when:** `streamAnalysis` streams identically against DeepSeek with the same
prompts/parse behavior; error strings interpolate provider label; error routing
uses typed codes with per-provider classification; SSE parser passes the new
buffer-split + tail + final-read + post-`[DONE]` tests (Testing strategy); client
disconnect aborts the upstream fetch within a bounded time and the heartbeat stops
in the close handler; upstream timeout and response cap are typed errors.

### Step 2 — Provider registry + pricing

Add `providers.ts` with DeepSeek as default; move pricing into provider entries
(config model in companion doc). `calculateCost` **changes signature** to
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

### Step 3 — API keys: unify client stores, then per-provider keys

**Key source of truth (resolved — request-body keys):** the analyze path takes the
key from `req.body` today, and there are **two divergent client stores**
(`codevibes-storage` zustand for `AnalyzePage`, `vibeguard_deepseek_api_key`
localStorage for the snippet path) plus a **write-only** DB column and a dead
`PUT /api/auth/deepseek-key` client call. **Decision: keep request-body keys** —
the client sends the key for the selected provider, the server uses it. No
server-side resolution, no precedence rules, no decryption in the hot loop.
Consequences (all resolved):

1. **Unify the client stores** — one key store (provider + key + model) consumed
   by `AnalyzePage`; migrate `vibeguard_deepseek_api_key` readers/writers to it.
   `SetupPage` and `SettingsModal` write to the same store.
2. **Delete the dead endpoint + the write-only column (resolved):** `PUT
   /api/auth/deepseek-key` is never invoked from the client — **delete the
   endpoint, `authController.saveDeepSeekKey`, the client `saveDeepSeekKey`
   (api.ts:293), and the write-only `users.deepseek_key` column** (database.ts:36,
   plus its decrypt in `optionalAuth`, database.ts:139-147) in a cleanup pass
   after the main work lands. If server-side key storage is ever wanted, it's a
   clean addition later. Same cleanup must update `ApiReferencePage` (it
   documents the key endpoint) — no docs describing a deleted API.
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
  **deterministically errors** today (`parseGitHubUrl('code-snippet')` returns
  `null`, analysisService.ts:92-97 → `INVALID_URL`, stream ends). Fixing it *and*
  threading provider support is double work for a broken feature. Remove the
  snippet-analyze flow: `useAnalysis` (sole consumer is `Index.tsx`), the
  `repoUrl: 'code-snippet'` call, and the DropZone analyze wiring. **Keep
  `useHistory`** (also consumed by `ResultsPage`) and the home page itself — only
  the dead analyze path goes. Frame this removal explicitly in the PR as a
  product cut; rebuild the feature on the new architecture if wanted later.

**Done when:** one client key store serves `AnalyzePage`; the dead endpoint,
`saveDeepSeekKey`, and `users.deepseek_key` column are gone (with
`ApiReferencePage` updated); fallback matrix covered by tests; `validateApiKey`
wired into Settings "test key" and provider-aware; `analyzeFiles` and the
snippet-analyze path removed; existing stored DeepSeek keys still load after the
store migration.

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
- **`GET /estimate` contract (from review §3.3 — resolved):** the endpoint takes
  no API key (it estimates tokens from the GitHub tree, never calls the AI
  provider) and should stay that way. It gains a `provider` (default `deepseek`)
  query param and returns **token counts + the provider's pricing metadata**
  (`inputCostPerMillion`/`outputCostPerMillion`/`pricingStatus`) so the frontend
  renders an estimated cost from server-provided pricing — a deliberate exception
  to "server computes cost", since there's no stream and no `complete` event here.
  It must **not** take the user's API key, and the frontend must not multiply by a
  hardcoded rate (it multiplies by the numbers the server returned).
- README/setup: document provider picker, per-provider keys, and the env-var
  contract (companion doc) for self-hosters.
- API docs for the changed key endpoint and new `AnalyzeRequest.provider`/`model`
  fields.
- Release gate (manual, demoted from being the only verification): validate against
  at least one second real provider from the candidate list (companion doc).
- **Rollback/feature-flag strategy (from review §2.4, scoped per R3):** because
  this touches the core analysis pipeline, the first deploy keeps a simple env
  flag `USE_LEGACY_PROVIDER=true` (default off). **The flag is checked in
  `analysisService.analyzeRepository` only** — when set, the *entire* analyze
  call routes to the untouched `deepseekService.streamAnalysis` path, not just
  provider selection. A bug in the new SSE parser must be swappable cleanly, not
  half-bypassed. If streaming or cost regresses post-deploy, flip it without a
  code revert. The flag is removed once the new path has run clean in production
  for a few days.

**Done when:** invalid provider/model rejected with 400 + valid lists; `GET
/estimate` honors `provider` and returns pricing metadata (no key required); docs
updated; tests green (Testing strategy); one second provider validated and
recorded; `USE_LEGACY_PROVIDER` rollback flag in place.

### Step 6 — Pricing freshness: CI check + UI flags + history schema

- Add `scripts/check-pricing.mjs` (runnable locally + in CI) implementing the
  pricing-freshness logic from the companion doc: machine-readable diff for
  OpenRouter, staleness check (`pricingAsOf` age vs
  `PRICING_STALE_AFTER_DAYS` — **default 90, env-configurable**, documented in
  README with the env-var contract) for all providers, clear exit codes/messages.
- Add `pricing-check.yml` cron (**monthly, or configurable per provider — weekly
  is too frequent for page-only providers whose only action is a human checking a
  webpage**, per review §4.3) running the script. **On drift (resolved):**
  **auto-PR** updating `inputCostPerMillion`/`outputCostPerMillion`/`pricingAsOf`
  for machine-diffable providers (OpenRouter — the script already fetches live
  numbers; an issue just adds a manual PR step); **open an issue** for
  staleness-only findings on page-only providers (DeepSeek, OpenAI). Both are
  informational, not merge gates. The workflow needs `contents: write` +
  `pull-requests: write` permissions for the auto-PR path.
- Backend: expose `pricingStatus` (`current` | `stale` | `unknown`) + `pricingAsOf`
  per provider in the estimate/complete payloads (from the registry, cheap — no
  network).
- **Persist provider/model in the `analyses` row** (database.ts:42-57 has
  `cost`/`tokens_used` but no provider/model), so history rows stay unambiguous
  ("$0.82 on DeepSeek" vs "on OpenRouter") — add `provider`, `model`, and a
  cost-basis flag (`metered` | `estimated`) columns, following the repo's informal
  migration pattern (`CREATE TABLE IF NOT EXISTS` + `try { ALTER TABLE } catch`,
  database.ts:64-71). `saveAnalysis` + history display (`ResultsPage`) surface
  them. **Backfill (from review §3.4, ordered per R4):** existing rows get
  `NULL` for the new columns. The `ALTER TABLE` (in the informal
  `try/catch` migration) and the backfill **`UPDATE` must be separate
  statements** — on a large history table the UPDATE can lock it, so don't run
  it inline in the same try/catch; run it as a distinct statement after the
  schema change (manually or a background step). Backfill value:
  `provider='deepseek'`, `model='deepseek-chat'`, `cost_basis='estimated'`
  `WHERE ... IS NULL` (every historical row was DeepSeek via the old hardcoded
  path); the UI renders "Unknown provider" only if a row still has `NULL`
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
  chunk are ignored** (break, not continue).
- **`parseIssuesFromResponse`**: markdown-wrapped JSON, empty `issues`, missing
  `category`/`severity` normalization, `undefined` line.
- **`calculateCost` / provider pricing**: per-provider numbers; asserts the new
  signature has no DeepSeek-default fallback.
- **Error classification**: per-provider `classifyError` — OpenAI 401/429 shapes,
  Groq different body shapes, unrecognized shape falls back to `PROVIDER_ERROR`
  (Step 1).
- **Provider registry**: DeepSeek default resolution, env-override precedence
  (companion doc), unknown-provider handling, `baseUrl`+path concatenation,
  **env values read at import time vs per-request** (see Open Decision — tests
  must not race module init), **registry read-only after init** (concurrency).
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
  boundary future non-OpenAI providers must implement (one paragraph so the next
  dev doesn't re-couple).
- API docs: removed key endpoint (`ApiReferencePage`), new
  `AnalyzeRequest.provider`/`model` fields.
- Link from the "explore how codevibes works" TO_DO doc to this plan.

---

## Open decisions (all resolved 2026-08-19, Rev 6)

Decision record — each entry: decision + one-line rationale. Nothing here blocks
implementation.

- [x] **Near-term scope: OpenAI-compatible only.** DeepSeek already uses the
      shape; multi-protocol now would roughly double scope for no near-term gain.
      The `ProviderClient` interface keeps the adapter boundary open.
- [x] **Provider config: code registry for now.** DB config later only if users
      need runtime provider editing; migration path is a `providers` table seeded
      from the registry.
- [x] **Azure OpenAI: defer.** Needs `urlTemplate` (`/deployments/{name}/…`) +
      `queryParams` (`api-version`) fields the config model lacks, and is the
      hardest to test (subscription + deployed model). Tracked as follow-up;
      `authScheme` stays `bearer`|`none` (bearer + static `headers` covers
      OpenRouter — no `custom` value).
- [x] **Key source of truth: request-body keys.** Matches today's flow; no
      server-side resolution, precedence rules, or decryption in the hot loop;
      security posture unchanged (HTTPS body).
- [x] **Dead key endpoint + column: delete.** `PUT /api/auth/deepseek-key` is
      never called from the client; delete endpoint, `saveDeepSeekKey` (client +
      controller), and the write-only `users.deepseek_key` column in a cleanup
      pass after the main work, updating `ApiReferencePage` too.
- [x] **Per-provider key storage shape: moot (deferred).** No server-side keys in
      near-term; if ever needed, `provider_keys` JSON column is the cleaner long
      term and the informal migration pattern handles it.
- [x] **`validateApiKey`: wire into Settings "test key".** Dead exported code is
      a liability; one API call + button + toast gives users key feedback before
      a full analysis. Made provider-aware (Step 3/4).
- [x] **`analyzeFiles`: delete.** Unused; a second provider-coupled entrypoint
      that must be updated forever. Rebuild on `aiProvider.ts` if ever needed.
- [x] **Snippet path: delete (product cut).** Home-page paste-analyzer
      deterministically errors today (`parseGitHubUrl('code-snippet')` → null →
      `INVALID_URL`); fix + provider support is double work for a broken feature.
      Keep `useHistory`/home page; remove the `useAnalysis`-scoped flow.
- [x] **Env read timing: import-time.** Matches `deepseekService.ts:17`; registry
      built once, immutable (supports the concurrency requirement); testable via
      `vi.resetModules()` re-imports. Document "restart the server after changing
      `AI_*` env vars".
- [x] **Streaming `usage`: implement `stream_options: { include_usage: true }`.**
      DeepSeek + OpenAI return real `usage` in the final chunk; metered vs
      estimated differs by 10-30%. Parse it before `[DONE]`, fall back to
      estimates per the provider's `streamingUsage` flag (Ollama etc.).
- [x] **Staleness threshold: 90 days, env-configurable**
      (`PRICING_STALE_AFTER_DAYS`). Most providers change pricing quarterly at
      most; operators can tighten it (~5 lines, documented in README).
- [x] **CI drift action: auto-PR (machine-diffable) + issue (page-only).**
      OpenRouter drift → PR with updated pricing + `pricingAsOf` (script already
      diffs live numbers; an issue just adds a manual PR step); DeepSeek/OpenAI
      staleness → issue (no diffable source). Informational, not merge gates.
- [x] **Live pricing (OpenRouter runtime `/api/v1/models`): defer to follow-up.**
      Runtime calls add latency/failure modes/caching to every request; registry
      + flags + CI covers ~95% of the value.
- [x] **Second validation provider: OpenRouter.** Max model choice with one key
      (exercises picker end-to-end), genuinely OpenAI-compatible (exercises the
      `headers` field), machine-readable pricing (exercises the CI check), free
      tier, and it's not Ollama — the no-auth/no-usage path is a *different* test
      case and becomes a separate (mocked or local) integration test.
- [x] **`GET /estimate` contract: token-only + pricing metadata, no key.** It
      estimates from the GitHub tree and never calls the AI provider; frontend
      multiplies by the server-returned rates (no hardcoded literal).

## Related work

- TO_DO item: explore and document how codevibes works (file selection + reviewing
  agent instructions) — the doc it produces should reference this plan.
- `fileFilter.ts` / `githubService.ts` are provider-agnostic; no changes expected
  there.

---

## Revision log

- **Rev 6 (2026-08-19):** all open decisions resolved per the round-3 review's
  recommendations: OpenAI-compatible only; Azure deferred; request-body keys +
  unified store; dead key endpoint + `users.deepseek_key` column deleted (cleanup
  pass, `ApiReferencePage` too); key-storage shape moot; `validateApiKey` wired
  into Settings "test key"; `analyzeFiles` + snippet path deleted (product cut,
  `useHistory` kept); env read at import-time; `stream_options` usage capture;
  90-day env-configurable staleness; auto-PR (machine-diffable) + issue
  (page-only); live pricing deferred; OpenRouter as second validation provider.
  Folded in R1-R4: `classifyError(status, bodyText)` contract; response cap
  checked mid-stream; `USE_LEGACY_PROVIDER` checked only in `analyzeRepository`;
  backfill `UPDATE` separate from the ALTER. No blockers remain.
- **Rev 5 (2026-08-19):** round-3 review. Step 1: heartbeat cleared in
  `req.on('close')` (verified controller:81); SSE final-read dropped + `[DONE]`
  must `break`; per-provider error classification; upstream timeout
  (`PROVIDER_TIMEOUT`); response cap (`RESPONSE_TOO_LARGE`); read-only registry;
  Steps 1+2 atomic. Step 2: backend-first deploy order + old-shape tolerance;
  "8+3" clarified. Step 3 blockers note. Step 5: `GET /estimate` resolved
  (token-only + pricing metadata); `USE_LEGACY_PROVIDER` flag. Step 6: backfill +
  monthly cron. Vitest/CI documented; Azure deferred.
- **Rev 4 (2026-08-19):** round-2 review. Key-flow premise corrected (request-body
  keys, write-only DB column, two client stores, dead `PUT /deepseek-key`); Step 3
  rewritten around key source of truth; 3 frontend hardcoded-pricing sites;
  `complete` event as single cost source; `analyses` schema gains
  provider/model/cost-basis; typed error codes + `decoder.flush()`; DeepSeek-brand
  UI touchpoints; controller validation incl. `GET /estimate`. Split into plan +
  research docs to stay under the file-size cap.
- **Rev 3 (2026-08-19):** pricing freshness — `pricingAsOf`/`pricingSource`,
  `current`/`stale`/`unknown` badges (kept but labeled, never fabricated),
  `check-pricing.mjs` CI cron, Step 6, staleness tests.
- **Rev 2 (2026-08-19):** round-1 review — key-storage model corrected (user-record
  column, DB migration); `validateApiKey`/`analyzeFiles` fates; `baseUrl`/path +
  env contracts; per-provider `maxTokens` + `authScheme`/`headers`; SSE
  frame-buffer bug as must-fix; streaming-`usage` decision; `calculateCost`
  breaking change (8 sites); no-cross-provider key fallback; parameterized error
  messages; testing + docs sections; registry-vs-DB resolved; acceptance criteria.
- **Rev 1 (2026-08-19):** initial draft, NEEDS REVIEW.