# Plan B (Item 5) — Selectable Effort / Detail Layers

> **Status:** REVIEWED — split around the legacy-provider constraint.
> **Risk:** High: request validation, SSE, estimation, persisted history, and the analysis UI all
> change together.

## Verified baseline and constraints

- `POST /api/analyze` accepts `{ repoUrl, apiKey, priority }`; `GET /api/estimate` accepts only
  `repoUrl`. Both the backend and `src/lib/api.ts` have separately declared contracts.
- `MAX_FILES_PER_PRIORITY` is an import-time `parseInt` value used by the live fetch, the next-tier
  estimate, and the pre-analysis estimate. There are no `analysisService` unit tests today.
- The legacy stream always sends `max_tokens: 8000` and builds prompts in frozen
  `deepseekService.ts`. A B-now change cannot truthfully claim to change prompt depth or output
  budget on that path.
- The analysis page runs priorities serially. Its history save currently recomputes price from a
  hard-coded `$0.14` rate and its async state updates can leave the final save with stale totals.
  Effort work must fix this session accounting rather than adding another client-side estimate.
- `analysisStore` is not persisted as a Zustand store; only the API key has dedicated encrypted
  storage. A new preference needs its own validated storage key and tests.

## Public contract

`EffortLevel = 'quick' | 'standard' | 'thorough'`. The server defaults a missing value to
`standard`; it rejects non-strings, arrays, and unknown values with a JSON 400 before opening SSE.
The resolved value is returned in every `complete` event (including the zero-files completion),
the estimate payload, and saved analysis history.

Capture effort at **Start analysis**, keep it immutable through the three priority approvals, and
disable the selector until the run ends. A user may remember a preferred default for the next run,
but that preference never rewrites an in-flight or historical analysis.

| Layer | B-now (legacy-safe) | After provider routing is live |
|---|---|---|
| quick | fetch/analyze at most 5 files per priority | concise prompt and provider-resolved lower output limit |
| standard | 20 files; unchanged legacy prompt and 8000 output limit | standard prompt remains byte-for-byte equivalent in meaning |
| thorough | 40 files, subject to the server safety maximum | deeper prompt and provider/model-resolved output limit |

The 40-file figure is a policy target, not permission to overrun a context window. The provider
path must enforce a total input-content/token budget before sending a request and report truncation
or skipped files; simply slicing a string is not acceptable because it can produce misleading
reviews.

## Phase B1 — scope, API, UI, and history (may ship now)

1. Put `EffortLevel`, `CompleteEventData.effort`, and `AnalysisEstimate.effort` in backend types;
   mirror all affected types in `src/lib/api.ts`. Update request interfaces even if they are not
   currently used at runtime.
2. Add a pure, tested resolver for the per-effort cap. Preserve a global hard safety maximum and
   make its semantics explicit:
   - retain `MAX_FILES_PER_PRIORITY` as the administrator's upper bound, raising its documented
     default to at least 40 before thorough can reach 40;
   - introduce `EFFORT_QUICK_MAX_FILES`, `EFFORT_STANDARD_MAX_FILES`, and
     `EFFORT_THOROUGH_MAX_FILES` defaults of 5/20/40; resolve each as `min(layerCap, globalCap)`;
   - parse positive whole-number environment values strictly and fail configuration validation on
     invalid values rather than accepting `parseInt('20oops')` or `NaN`.
   This intentionally changes the meaning of the global default, so document the migration and
   test a deploy still using `MAX_FILES_PER_PRIORITY=20` (thorough is safely capped at 20).
3. Thread resolved effort and its resolved cap through `analysisController.analyze` →
   `analyzeRepository` → both `getFilesForPriority` calls. Thread effort through `estimate` and
   `getEstimate`; calculate all three capped buckets from the same resolver. Return the resolved
   cap as `maxFilesPerPriority` as well as effort, so estimates remain explainable when an admin
   cap limits thorough.
4. Do **not** add `EFFORT_MAX_TOKENS` in B1. It would be unused on the frozen legacy path and
   make the API promise false. Keep 500 input tokens/file and the 0.2 output ratio as the existing
   estimate model; changing the file cap alone changes the projected total.
5. Add `EffortSelector.tsx`; do not enlarge the already-excepted `AnalyzePage.tsx`. The component
   is controlled by an analysis-session effort value. Persist only the last selection for the next
   run in a namespaced local-storage key, validate the stored string, and fall back to `standard`.
   Send effort on both analyze and estimate calls; cancel/ignore stale estimate responses when the
   selector or repository changes.
6. Add explicit run accounting: accumulate server `complete.cost` and `tokensUsed` in a session
   object/store, use those server values for live UI and `saveAnalysis`, and pass an immutable
   final snapshot to history persistence. Do not compute cost in `AnalyzePage` or `ResultsPage`.
7. Satisfy persistence per analysis now: add a nullable-or-defaulted `effort` column through the
   database migration path, database types, history controller, API client, save payload, and
   history response/view. Old rows display “standard/unknown legacy value” deliberately; do not
   infer a value from their token count. Coordinate the migration ordering with the provider plan,
   but do not defer this requirement to its optional later schema work.

## Phase B2 — bounded review-scope transparency (decision gate)

If the product accepts the scope UI proposed during Plan A review, make it a defined contract:

- Extend the estimate response with `ignoredFiles` count and static, versioned classifier metadata
  (recognized extensions and named rule summaries). Do not return raw ignored paths by default.
- If per-file explanations are required, add a classifier function that returns `{ priority, ruleId
  }` and an authenticated, size-bounded endpoint/estimate field containing only selected paths and
  rule IDs. Define pagination and private-repo authorization explicitly.
- Render rule summaries and counts near the selector. A full ignored-file drill-down is a separate
  opt-in endpoint with pagination; never manufacture reasons in the frontend.

This phase is not needed to make effort layers functional. It must not quietly turn Plan A into a
new GitHub-tree data API.

## Phase B3 — prompt and output budget (after provider Steps 1+2 **and** routing)

The new provider service/registry owns `getPromptForPriority(priority, effort)` and effective
`max_tokens`. It must preserve the JSON schema and standard behavior, clamp the requested layer
limit to the selected model capability, and expose the resolved limit in server diagnostics or the
estimate contract as appropriate. Do not modify `deepseekService.ts`.

This phase cannot ship merely when `aiProvider.ts` exists: provider plan Step 5 must route normal
requests through it. While `USE_LEGACY_PROVIDER=true` routes DeepSeek requests to the frozen file,
the UI must either label effort as scope-only or the server must return a capability flag; it may
not claim quick/thorough changed prompt/output behavior.

## Required tests

- Controller: omitted effort defaults; every invalid body/query shape returns 400 before SSE;
  valid effort is forwarded; estimate effort is parsed exactly once.
- Service (new mock-based `analysisService` suite): resolver precedence/invalid config, each live
  and next-priority fetch uses the same resolved cap, estimate bucket math, and `effort` on normal
  and zero-file complete payloads.
- API/frontend: request/query serialization, effort-change estimate race handling, selector
  preference validation, locked session effort across approval, and display/history use accumulated
  server cost rather than a `$0.14` formula.
- Database/history: migration/backfill, saved effort round-trip, and legacy-row rendering.
- B3 provider tests: standard schema/prompt contract, layer-to-model-limit clamping, input budget
  truncation reporting, and legacy-routing capability behavior.

## Documentation and verification

Update `.env.example`, `03-orchestration-sse.md`, `05-cost-model.md` if estimate semantics change,
`04-reviewing-agent.md` for B3, `06-extension-hooks.md`, and the pipeline index. Update the
contract generator together with any change to source cap representation; the current regex expects
the old `MAX_FILES_PER_PRIORITY = parseInt(...)` declaration and will otherwise throw.

Run `npm run test:all`, `npm run typecheck`, `npm run lint:all`, `npm run check:pipeline-contract`,
`npm run check:pipeline-docs`, and `npm run check:structure`.
