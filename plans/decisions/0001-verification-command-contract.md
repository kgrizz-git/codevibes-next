# 0001 — Verification Command Contract

- **Status:** Accepted
- **Date:** 2026-08-20
- **Owner:** Documentation/agent-guidance workstream
- **Review date:** 2026-11-01

## Context

A new agent or contributor must pick the cheapest valid verification command
without a repository-wide search. The frontend is at the repo root and the
Express/TypeScript backend is in `codevibes-backend/`; they remain independent
npm packages. Root aliases provide one discoverable interface without hiding
that topology. The docs must describe only commands that exist in
`package.json`, so guidance never contradicts executable configuration.

## Decision

Use root aliases as the canonical verification contract. The original narrow
scripts remain supported for compatibility and local iteration.

**Root package (`npm run …`):**
- `dev` — Vite dev server (frontend)
- `build` — `vite build` (frontend)
- `lint` — `eslint .` (frontend)
- `typecheck` — `tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p codevibes-backend/tsconfig.json` (both packages)
- `test` — `vitest run` (frontend)
- `prepare` — activates Husky hooks
- `lint:frontend`, `lint:backend`, `lint:all` — lint the named boundary or both
- `test:frontend`, `test:backend`, `test:all` — run the named suite or both
- `build:frontend`, `build:backend`, `build:all` — build the named boundary or both
- `check:fast` — lint, typecheck, and affected tests (full suites without a base)
- `check:all` / `ci` — full local and CI gate
- `repo:map` — generated, shallow navigation map
- `check:doc-links` and `check:guidance` — strict documentation/guidance checks
- `docs:pipeline-contract` — regenerate the source-owned review-pipeline facts page
- `check:pipeline-contract` and `check:pipeline-docs` — verify that generated
  facts are current and mapped pipeline source changes updated their human docs
- `check:structure` / `check:structure:advisory` — source line-count and
  absolute-path checks; the strict command uses non-increasing ceilings for
  four named legacy files
- `check:complexity` — blocking shrink-only budget for structural ESLint rules
- `check:bundle-size` — advisory bundle budget pending frontend cleanup

**Backend package (`npm --prefix codevibes-backend run …`):**
- `dev` — `tsx watch src/server.ts`
- `build` — `tsc` (emits `dist/`)
- `start` — `node dist/server.js`
- `lint` — `eslint src`
- `typecheck` — `tsc --noEmit`
- `test` — `vitest run`

**Repo script (node, not npm):**
- `node scripts/check-file-size.mjs [--staged] [--advisory]` — line-count +
  absolute-path gate, blocking by default

## Consequences

- Agents can rely on the listed commands verbatim.
- CI runs `npm run ci`; hooks use the same script family for their narrower gates.
- Legacy structural debt cannot grow: line ceilings and complexity diagnostics
  only move downward until their exceptions are removed.
- Any command change must update this record and the README together.

## Supersedes / Superseded-by

- Supersedes: none
- Superseded-by: none.
