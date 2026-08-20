# 0004 — Targeted Coverage Policy and Ratchet

- **Status:** Accepted
- **Date:** 2026-08-20
- **Owner:** Documentation/agent-guidance workstream
- **Review date:** 2026-11-01 (re-evaluate when per-directory floors are set)

## Context

Both packages now run Vitest with `@vitest/coverage-v8` (verified 2026-08-20).
There are focused tests at the backend boundaries (CSRF, origins, auth,
encryption, fileFilter) and a frontend test setup, but no global coverage floor
is enforced. `plans/quality-gates-hooks-ci.md` (Step 5) recommends starting
thresholds at 0 and ratcheting only after a meaningful suite exists, and
`plans/TO_DO.md` directs non-zero per-directory floors to land **only after**
the relevant tests exist.

A naive global percentage would reward incidental UI coverage and punish the
boundary-focused work that matters (auth/CSRF, analysis/SSE contracts, file
selection, token-cost, frontend analysis state).

## Decision

- **No blocking global coverage threshold today.** The canonical `npm run ci`
  path runs `test:all:coverage`, collecting Vitest text and JSON-summary
  coverage for both packages, but does not gate merges at 0%.
- **Boundary-first, not global.** Add focused tests at high-risk boundaries
  before introducing any floor: backend CSRF/auth failure modes, analysis
  controller schemas, GitHub error handling, SSE framing/parser; pipeline file
  categorization and token/cost; frontend API/CSRF client and analysis-store
  transitions.
- **Ratchet per-directory, in changed areas only.** Once tests exist for a
  directory, set a non-zero floor for that directory and raise it only on
  changed code. Do not impose today's 0% as a blocking number.
- Thresholds are raised deliberately (manual ~5%/sprint or `autoUpdate` locally
  for the ratchet), not silently by `latest`-style tooling drift.

## Consequences

- CI reports coverage but will not fail on low numbers until a floor is
  declared for a given directory.
- Incentive stays on critical boundaries rather than UI breadth.
- The exact floor values live with the test work (Phase 4 of
  `plans/harness-engineering.md`), not in this record, which only sets policy.

## Supersedes / Superseded-by

- Supersedes: none
- Superseded-by: per-directory floor records as they are introduced.
