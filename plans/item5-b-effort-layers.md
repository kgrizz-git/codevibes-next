# Plan B (Item 5) — Selectable Effort / Detail Layers

> **Status:** NEEDS REVIEW
> **Workstream:** let users choose review **effort/detail** (e.g. `quick` vs `standard` vs
> `thorough`), scaling agent prompt depth, file cap, and token budget; surface it
> in the UI, persist per-analysis, and report it in the `complete`/estimate payloads.
> **Part of:** `plans/item5-overview.md`. **Prereq:** item 1 docs
> (`docs/review-pipeline/03-orchestration-sse.md`, `04-reviewing-agent.md`).
> **Risk:** Medium-High — cross-cutting change (config → API → service → SSE payload → UI → store).
> **Coordinates with:** provider plan (`plans/model-provider-compatibility.md`) — do not hardcode
> layer→token math in a way that blocks provider-aware pricing later.

## Current state (verified)
- **API contract** (`analysisController.ts`): `POST /api/analyze` body = `{ repoUrl, apiKey, priority }`
  (`:20`); `priority` validated to 1|2|3 (`:33-37`). `GET /api/estimate?repoUrl=` (`:91`).
  SSE headers + 15s heartbeat (`:43-59`). Client disconnect logged (`:50`).
- **Orchestration** (`analysisService.ts`): `analyzeRepository(res, repoUrl, apiKey, priority, githubToken?)`
  (`:81`); `MAX_FILES_PER_PRIORITY = parseInt(process.env.MAX_FILES_PER_PRIORITY || '20')` (`:23`);
  calls `deepseekService.streamAnalysis(files, apiKey, priority)` (`:161`); `complete` payload
  `{ priority, filesScanned, issuesFound, tokensUsed, cost, nextPriorityEstimate? }` (`:198-205`);
  `getEstimate` uses `AVG_TOKENS_PER_FILE = 500`, `OUTPUT_RATIO = 0.2` (`:257-258`).
- **Agent** (`deepseekService.ts`): `getPromptForPriority(priority)` (`:633`) → 3 prompts;
  `temperature: 0.3`, `max_tokens: 8000` (`:728,729,804,805`); enforced JSON schema; P1=CRITICAL/HIGH/MEDIUM/LOW,
  P2=HIGH/MEDIUM/LOW, P3=MEDIUM/LOW.
- **Frontend**: `AnalyzePage.tsx` consumes SSE for repo analysis. NOTE: `useAnalysis.ts` is the
  **code-snippet** path (priority 1 only) — the provider plan Step 3 **deletes** this path and the
  hook entirely, so effort support must NOT be added there. `analysisStore` holds `apiKey`
  (priority is NOT persisted today — see persistence note). No effort concept exists today.

## Proposed design
Introduce an `effort` dimension orthogonal to `priority`. Three layers:

| Layer | `max_tokens` | Effective file cap | Prompt depth | Target use |
|---|---|---|---|---|
| `quick` | 2000 | 5 | terse; "report only CRITICAL/HIGH, be concise" | fast pre-PR sanity |
| `standard` | 8000 | 20 (today's default) | current prompts unchanged | default |
| `thorough` | 8192 (cap) | 40 | deeper instructions; "report LOW too, include rationale" | pre-release audit |

Notes:
- `standard` MUST preserve today's behavior exactly (no behavior change for existing users).
- **`max_tokens` ceiling is model-dependent.** The current default model `deepseek-chat`
  enforces `max_tokens ∈ [1, 8192]`; passing `16000` returns HTTP 400. So `thorough` caps at
  **8192**. "Thoroughness" comes from the larger file cap (40) + deeper prompt text, NOT from a
  higher `max_tokens`. Once the provider plan's registry lands, per-model `max_tokens` ceilings
  should move there (see Coordination).
- **No input-context overflow guard today.** `BATCH_SIZE = 5` is hardcoded (`githubService.ts:208`)
  and this plan does NOT change parallelism. The 40-file `thorough` cap risks exceeding the model
  context window on large repos; mitigate with a total-content/token budget in the prompt builder
  (or accept the truncation risk) — call this out in implementation.
- `temperature` stays 0.3. Effort is **per-analysis**, applied to whichever priority(ies) the
  analysis runs.

## Phases — split by the `deepseekService.ts` freeze

> **Critical dependency (validated):** `USE_LEGACY_PROVIDER` does **not** exist in code today —
> there is no `aiProvider.ts`/new provider path yet (only plans + docs reference it). And
> `deepseekService.ts` must stay **byte-for-byte intact** until the provider plan Step 1 retires
> the legacy path. Therefore any change to `getPromptForPriority` or `max_tokens` **inside
> `deepseekService.ts` cannot ship now**. Split execution accordingly:

### B-now (ships without touching `deepseekService.ts`)
All changes live in `analysisService.ts`, `analysisController.ts`, `types/index.ts`, and the
frontend — none in the frozen file.

- **Schema & config:** add `EffortLevel = 'quick' | 'standard' | 'thorough'` (`types/index.ts`).
  Add `EFFORT_MAX_TOKENS` and `EFFORT_FILE_CAP` lookup maps (env-overridable; `standard` keeps
  today's values: 8000 / 20). Document in `.env.example` (already lists `MAX_FILES_PER_PRIORITY`)
  and `03-orchestration-sse.md`.
- **API & orchestration:** `POST /api/analyze` accepts optional `effort` (default `standard`),
  validate ∈ enum → 400 before SSE headers (`analysisController.ts:20` area). `analyzeRepository`
  derives `maxFiles` from effort (replacing bare `MAX_FILES_PER_PRIORITY`) and passes `effort`
  through — but when routing to the **legacy** `deepseekService.streamAnalysis`, the effort param
  is **not** plumbed into prompt building (legacy path treats everything as `standard`). `complete`
  payload gains `effort` (add it to BOTH the main site `:198-205` and the zero-files early-return
  `:137-143`); `nextPriorityEstimate` uses the effort-aware file cap. `GET /api/estimate` accepts
  `effort`; `getEstimate` projects per-effort file caps into cost (keep `AVG_TOKENS_PER_FILE=500`,
  `OUTPUT_RATIO=0.2` × effort cap); return `effort`. Cover all cap sites: `analyzeRepository`,
  `getEstimate`, and the estimate endpoint.
- **Frontend surface & persistence (client-store only for MVP):**
  - **Extract `EffortSelector.tsx`** as a separate component — mandatory, not optional, because
    `AnalyzePage.tsx` is **1153 lines** (already over the 500-line cap; ceiling-capped in
    `structural-exceptions.json`). Do not grow it inline.
  - API client (`lib/api.ts`): send `effort` on `/api/analyze` and `/api/estimate`.
  - `analysisStore`: persist **last-selected effort** (follow the existing `theme`/localStorage
    pattern), NOT a DB column. **Do not claim `priority` is persisted** — it is not.
  - **Refetch the estimate when effort changes** (`AnalyzePage` fetches `getEstimate` on repo
    validation) so the cost projection tracks the selected layer.
  - Results view: show the server-computed `cost` (not the hardcoded `0.14` sites in
    `AnalyzePage.tsx:391,1042`), plus an effort badge. Coordinate with provider plan Step 2
    ("frontend must stop computing cost").
  - **Review-scope surface (paired with Plan A):** in the pre-analysis view, show *what is being
    reviewed* — active ignore patterns, the recognized language/extension set, priority rules, a
    per-file "matched `<rule>` → Pn" hint, and an "N files ignored" count with drill-down. This
    makes the file/folder patterns passed visible in-app (not just in `docs/review-pipeline/`),
    and sits next to the `EffortSelector` so users understand both *what* and *how deep*. Derive it
    from the backend `fileFilter` rules (via an endpoint or the contract doc), never a client-only
    copy that can drift.
  - **Do NOT add effort to `useAnalysis.ts`** — that code-snippet path is deleted by provider plan
    Step 3.
- **Tests:** effort on both `complete` sites; `standard` payload shape identical to today (minus
  the added field); effort validation 400 before SSE; effort-aware caps in `analyzeRepository` and
  `getEstimate`; estimate math. Borrow the provider plan's test list.

### B-after-provider-Step-1 (once `aiProvider.ts`/new path exists)
- Move prompt-depth variants into the new provider service: `getPromptForPriority(priority, effort?)`
  returns `standard` verbatim for `standard`, deeper/terser text for `thorough`/`quick`, preserving
  the enforced JSON schema (add a schema-preservation contract test).
- Make `max_tokens` per-model via the provider registry (so `thorough`'s ceiling is the model's,
  not a hardcoded 8192). Keep `deepseekService.ts` untouched.
- Update `04-reviewing-agent.md` and `06-extension-hooks.md` (the latter currently tells people to
  edit `getPromptForPriority` in `deepseekService.ts` — wrong once B lands; repoint to the new
  path).
- **DB persistence (optional, defer):** if per-analysis history persistence is wanted, add an
  `effort` column to `analyses` (`database.ts`) + `historyController.saveAnalysis` + `api.ts`, and
  fold the migration into the provider plan Step 6 round (avoid two `ALTER TABLE`s). Existing rows
  get `NULL` (mirror provider plan backfill). MVP ships client-store only.

## Coordination / risks
- **Provider plan:** pricing is being made provider-aware there; `max_tokens` ceilings belong in
  the registry. Effort layer math must read from the same cost source (`calculateCost`) and not
  bake in DeepSeek-only assumptions. Defer provider-specific effort pricing to that plan.
- **deepseekService.ts legacy constraint (validated):** `USE_LEGACY_PROVIDER` is not in code yet,
  and the file is frozen. B-now must NOT edit it; the legacy path simply ignores `effort` (treats
  it as `standard`). Prompt/`max_tokens` variants wait for B-after-provider-Step-1.
- **Machine-checked contract:** B-now changes to `MAX_FILES_PER_PRIORITY`/cap math or `max_tokens`
  make `generated-contract.md` stale → `check:pipeline-contract` fails. Run
  `npm run docs:pipeline-contract -- --write` and commit. Extend `MAPPINGS` in
  `scripts/check-review-pipeline-docs.mjs` if a new pipeline source file is added (Plan C).
- **UX scope creep:** keep the selector minimal; effort is per-analysis only (not per-priority).

## Acceptance
- **B-now ships independently** of the `deepseekService.ts` freeze: no edit to the frozen file;
  legacy path ignores `effort` (acts as `standard`).
- `standard` is behavior-identical to today for the legacy path (payload shape identical minus the
  added `effort` field on both `complete` sites).
- `quick`/`thorough` measurably change file cap (+ prompt depth once B-after-provider-Step-1
  lands); cost estimate reflects the layer. `thorough` `max_tokens` ≤ 8192 (model ceiling).
- API rejects invalid `effort` with 400 (before SSE headers); missing `effort` defaults to
  `standard`.
- UI: `EffortSelector.tsx` extracted (does NOT grow `AnalyzePage.tsx`); persists last-selected
  effort to client store; sent on analyze + estimate; estimate refetched on effort change;
  results show server `cost` + effort badge.
- `npm run typecheck`, `npm test`, `npm run lint`, `scripts/check-file-size --strict`,
  `npm run check:pipeline-contract`, `npm run check:pipeline-docs` all pass.
- `docs/review-pipeline/` pages updated (Plan C), including regenerated `generated-contract.md`.

## Backwards compatibility
- Adding `effort` to `complete`/estimate is additive (old clients tolerate the new field). Cross-
  reference the provider plan's deploy-order note ("old tabs must tolerate the old `complete`
  shape"). Add a test that an old-style consumer still parses the new payload.

## Open questions (for reviewers)
- Default layer = `standard` (recommended).
- Should `quick` cap severity to CRITICAL/HIGH, or just be terser with fewer files? (Recommend
  fewer files + lower `max_tokens`, no severity cap.)
- Is effort per-analysis or per-priority? (Recommend per-analysis.)
- DB persistence of effort: MVP client-store only, or fold a column into provider plan Step 6?
  (Recommend MVP client-store, defer DB.)
