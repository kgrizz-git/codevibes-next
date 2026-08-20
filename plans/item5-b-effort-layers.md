# Plan B (Item 5) — Selectable Effort / Detail Layers

> **Status:** NEEDS REVIEW
> **Workstream:** let users choose review **effort/detail** (e.g. `quick` vs `standard` vs
> `thorough`), scaling agent prompt depth, file cap, parallelism, and token budget; surface it
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
- **Frontend**: `useAnalysis.ts` (code-snippet path, priority 1 only) and `AnalyzePage.tsx` consume
  SSE. `analysisStore` holds `apiKey`. No effort concept exists today.

## Proposed design
Introduce an `effort` dimension orthogonal to `priority`. Three layers:

| Layer | `max_tokens` | `MAX_FILES_PER_PRIORITY` (effective) | Prompt depth | Target use |
|---|---|---|---|---|
| `quick` | 2000 | 5 | terse; "report only CRITICAL/HIGH, be concise" | fast pre-PR sanity |
| `standard` | 8000 | 20 (today's default) | current prompts unchanged | default |
| `thorough` | 16000 | 40 | deeper instructions; "report LOW too, include rationale" | pre-release audit |

Notes:
- `standard` MUST preserve today's behavior exactly (no behavior change for existing users).
- `max_tokens` and file cap scale; `temperature` stays 0.3.
- Effort is **per-analysis**, applied to whichever priority(ies) the analysis runs.

## Phases

### Phase B0 — Schema & config (no behavior change for `standard`)
- Add `EffortLevel = 'quick' | 'standard' | 'thorough'` type (`types/index.ts`).
- Add `EFFORT_MAX_TOKENS` and `EFFORT_FILE_CAP` lookup maps (env-overridable, e.g.
  `MAX_FILES_PER_PRIORITY` becomes per-effort or a multiplier). Keep `standard` = today's values.
- `getPromptForPriority(priority, effort?)` gains optional `effort`; `standard` returns current
  prompts verbatim.
- Docs: update `04-reviewing-agent.md` (param added) + `03-orchestration-sse.md` (env knobs).

### Phase B1 — API & orchestration
- `POST /api/analyze` accepts optional `effort` (default `standard`); validate ∈ enum, else 400
  (`analysisController.ts:20` area). Pass through to `analyzeRepository`.
- `analyzeRepository` uses effort-derived `maxFiles` (instead of bare `MAX_FILES_PER_PRIORITY`)
  and passes `effort` to `streamAnalysis` → `getPromptForPriority`.
- `complete` payload gains `effort` field; `nextPriorityEstimate` computed with effort-aware
  file cap.
- `GET /api/estimate` accepts optional `effort`; `getEstimate` projects per-effort file caps
  and `max_tokens` into cost (keep `AVG_TOKENS_PER_FILE=500`, `OUTPUT_RATIO=0.2` but multiply by
  effort file cap). Return `effort` in estimate.
- Docs: update `03-orchestration-sse.md` (event payload, estimate) + `docs/review-pipeline.md`
  quick-reference table.

### Phase B2 — Frontend surface & persistence
- `AnalyzePage.tsx`: add an effort selector (segmented control / select) next to priority.
- `useAnalysis.ts` / API client (`lib/api.ts`): send `effort` in `/api/analyze` and `/api/estimate`.
- `analysisStore`: persist last-selected `effort` (mirror how `apiKey`/priority are persisted).
- Results view: show the effort badge alongside cost/severity (reuse existing cost/severity UI).
- Docs: update `06-extension-hooks.md` "Add selectable effort / detail layers" section to reflect
  the implemented shape.

### Phase B3 — Tests & quality gates
- Backend: unit tests for `getPromptForPriority(priority, effort)` (standard === current), effort
  validation 400, effort-aware file cap in `analyzeRepository` (mock `deepseekService`), estimate
  math.
- Frontend: update `lib/api.test.ts` for the new field; a smoke test for the selector.
- Ensure no file exceeds the 500-line quality-gate cap (Plan A/C note: `AnalyzePage.tsx` is
  already over the cap per TO_DO item 6 — coordinate the effort selector with that refactor, or
  extract an `EffortSelector` component to avoid growing it).

## Coordination / risks
- **Provider plan:** pricing is being made provider-aware there. Effort layer math must read from
  the same cost source (`calculateCost`) and not bake in DeepSeek-only assumptions. Defer
  provider-specific effort pricing to that plan.
- **deepseekService.ts legacy constraint:** do NOT edit `deepseekService.ts` logic until
  `USE_LEGACY_PROVIDER` is retired (TO_DO item 6 / provider plan Step 1). If the legacy flag
  still gates that file, implement B0/B1 prompt+effort changes **behind the new path only** and
  document in `04-reviewing-agent.md` rather than mutating legacy code. Verify the flag state
  before editing.
- **UX scope creep:** keep the selector minimal; avoid per-priority effort (per-analysis only).

## Acceptance
- `standard` is behavior-identical to today (tests prove prompt equality + identical payload shape
  minus the added `effort` field).
- `quick`/`thorough` measurably change file cap + `max_tokens` + prompt text; cost estimate
  reflects the layer.
- API rejects invalid `effort` with 400; missing `effort` defaults to `standard`.
- UI selector persists and is sent on analyze + estimate; results show the effort badge.
- `npm run typecheck`, `npm test`, `npm run lint`, `scripts/check-file-size --strict` all pass.
- `docs/review-pipeline/` pages updated (Plan C).

## Open questions (for reviewers)
- Default layer = `standard` (recommended).
- Should `quick` cap severity to CRITICAL/HIGH, or just be terser with fewer files? (Recommend
  fewer files + lower `max_tokens`, no severity cap.)
- Is effort per-analysis or per-priority? (Recommend per-analysis.)
