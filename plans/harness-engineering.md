# Plan: Agent Harness, Verification, and Maintenance

**Status:** proposed  
**Scope:** developer and agent guidance, repository navigation, local/CI checks,
and upkeep. This plan does not change product behaviour or the review pipeline.

## Outcomes

- An agent can identify the relevant boundary, documentation, and cheapest valid
  verification command without a repository-wide search.
- Contributors have one accurate command vocabulary for frontend, backend, fast,
  and full checks.
- Guidance and plans remain small, current, and mechanically checked where
  possible.
- Quality gates become enforceable only after existing exceptions have been
  resolved or deliberately documented.

## Decisions to record

Store accepted, durable choices in `plans/decisions/`, not a top-level
`docs/decisions/` directory. Use short ADR-style files named
`NNNN-kebab-case.md`, containing status, context, decision, consequences, and
supersedes/superseded-by links.

The first decisions should cover:

1. The canonical verification command contract.
2. Whether the two npm packages remain independent or become npm workspaces.
3. The line-limit policy, including the temporary legacy-provider exception.
4. The minimum targeted-coverage policy and how it ratchets upward.

`plans/` should have three clear classes: active implementation plans at its
root, accepted decisions in `plans/decisions/`, and historical research/plans in
`plans/archive/`. Do not move existing historical documents until their inbound
links have been updated in the same change.

## Phase 0 — Establish a truthful baseline

1. Correct README drift: Node version, local clone/fork workflow, backend tree,
   and dependency/service descriptions.
2. Replace references such as “TO_DO item 5” with named backlog headings or
   direct plan links.
3. Add a short "Developer commands" section to the README. `AGENTS.md` stays
   the source for agent-specific invariants; the README serves humans too.
4. Add the initial decision records above, including explicit owners and review
   dates for policies likely to change.

**Exit criteria:** documentation gives the same Node, package-manager, remote,
and verification guidance as the executable configuration.

## Phase 1 — Standardize command contracts

Add root scripts with unambiguous names; do not change `test` until its
compatibility impact is agreed. The target interface is:

| Script | Contract |
|---|---|
| `lint:frontend`, `lint:backend`, `lint:all` | lint the named boundary or both |
| `test:frontend`, `test:backend`, `test:all` | run the named suite or both |
| `test:frontend:coverage`, `test:backend:coverage`, `test:all:coverage` | run the named suite or both with coverage; CI uses the all-boundary form |
| `build:frontend`, `build:backend`, `build:all` | produce both distributables explicitly |
| `check:fast` | lint + typecheck + affected tests; no build or network |
| `check:all` | lint + typecheck + full tests + builds + strict doc/guidance, structural, and complexity checks + advisory bundle check |
| `ci` | alias of `check:all`, unless CI intentionally splits jobs for parallel feedback |

Keep direct `npm --prefix codevibes-backend` calls inside root scripts so agents
and contributors do not need to remember package topology. Decide separately
whether npm workspaces reduce enough duplication to justify a lockfile migration.

**Exit criteria:** CI calls canonical root commands; command descriptions and
hooks do not embed their own divergent check sequences.

## Phase 2 — Add low-cost navigation and guidance checks

Add only deterministic, offline scripts that have a clear owner:

| Script | Purpose | Where it runs |
|---|---|---|
| `scripts/repo-map.mjs` | Print compact package entrypoints, routes, services, tests, important docs, and ignored/generated paths. Support `--json` for tools. | on demand (`npm run repo:map`) |
| `scripts/check-doc-links.mjs` | Validate local Markdown links and anchors in README, docs, plans, and AGENTS files. | CI; changed docs in pre-commit if fast enough |
| `scripts/check-guidance.mjs` | Validate paths referenced by `AGENTS.md`, required command names, and declared decision/plan status metadata. | CI |
| `scripts/check-bundle-size.mjs` | Enforce agreed gzip budgets from Vite output after a baseline is accepted. | CI after frontend build |
| `scripts/check-review-pipeline-docs.mjs` | Require the mapped human-maintained pipeline page when its source module changes. | CI |
| `scripts/review-pipeline-contract.mjs` | Generate and verify source-owned pipeline facts (limits, events, pricing, extensions). | CI; on demand to update docs |

Do not generate and commit a repository map: runtime output cannot become stale.
Keep the map intentionally shallow—directory and boundary level, never a dump of
every component. Add scoped `AGENTS.md` files only when a subtree acquires rules
that do not apply elsewhere; start with `codevibes-backend/` and, if needed,
`docs/review-pipeline/`.

**Exit criteria:** a new agent can run `npm run repo:map`, open one relevant
guide, and choose a verification command in under three commands.

## Phase 3 — Make quality gates reliable

1. Split oversized UI modules behind stable tests. Keep
   `deepseekService.ts` excluded only while the documented legacy constraint
   applies; remove that exception with the provider migration.
2. Make `check:structure` blocking immediately. Grandfather only named legacy
   files above the 500-line cap with checked-in, non-increasing ceilings; remove
   each exception once it reaches the cap. Make structural ESLint limits
   (complexity, depth, file/function length, nesting) blocking with a
   shrink-only diagnostic baseline so no new or worsened violation can land.
3. Keep pre-commit limited to staged secret scanning, lint-staged, and cheap
   structural/doc checks. Continue allowing tools unavailable locally to print
   an actionable message while CI remains the enforcement point.
4. Keep pre-push to typechecking plus affected tests. Add a full-suite fallback
   when affected-test detection cannot establish a merge base.
5. Do not add a commit-message or post-checkout hook unless the team needs that
   policy; they add friction without addressing a current failure mode.
6. Pin or vendor Semgrep rules as well as the Semgrep binary, and schedule
   dependency/browsers-data reviews as non-blocking maintenance checks.

**Exit criteria:** local hooks, `check:all`, and CI agree on what blocks a
change, and each gate has a documented reason and runtime expectation.

## Phase 4 — Improve confidence with targeted tests

Start with boundary behaviour rather than a global coverage percentage:

1. Backend: CSRF/auth failure cases, analysis controller schemas, GitHub error
   handling, and SSE framing/parser behaviour.
2. Pipeline: file categorization priority/ignore contracts, token/cost results,
   and emitted SSE event shapes.
3. Frontend: API/CSRF client behaviour, analysis-store transitions, and the
   primary analysis flow’s loading/error/complete states.
4. Introduce per-directory coverage floors after tests exist; ratchet them only
   in changed areas. Do not make today’s 0% global thresholds blocking.

**Exit criteria:** critical boundaries have focused tests and non-zero,
intentionally chosen thresholds that prevent regressions without rewarding
incidental UI coverage.

## Phase 5 — Keep the harness maintained

- Use a scheduled, non-blocking maintenance workflow for `npm outdated`,
  Browserslist database age, and documentation/decision review dates.
- Maintain a short “harness ownership” section in this plan naming the scripts,
  hook policy, and CI workflow as the places to update together.
- Review the repo map, local-link checker, and guidance checker whenever the
  package layout or documentation lifecycle changes.

## Delivery order

1. Phase 0 and command decision.
2. Phase 1 command aliases and CI adoption.
3. Phase 2 navigation/check scripts.
4. Phase 3 structural cleanup and strict enforcement.
5. Phase 4 targeted coverage ratchet.
6. Phase 5 scheduled upkeep and archive migration.

Each phase should land in a small PR with its own tests/checks, not as one
cross-cutting migration.
