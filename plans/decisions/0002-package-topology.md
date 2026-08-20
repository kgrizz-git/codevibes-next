# 0002 — Package Topology: Two Independent npm Packages

- **Status:** Accepted
- **Date:** 2026-08-20
- **Owner:** Documentation/agent-guidance workstream
- **Review date:** 2026-11-01 (re-evaluate if a lockfile-migration case is made)

## Context

The repository is a fork of `danish296/codevibes` with a Vite/React/TS frontend
at the repo root and an Express/TS backend in `codevibes-backend/`. Two
plausible topologies exist:

1. **Two independent packages** — each with its own `package.json`,
   `package-lock.json`, and `node_modules`. No `workspaces` field in the root.
2. **npm workspaces** — root declares `workspaces`, hoists one lockfile.

A prior decision (`plans/quality-gates-hooks-ci.md`, top-of-plan) already
standardized on **npm** and deleted the tracked `bun.lockb`. Whether to also
migrate to workspaces was left open.

## Decision

Keep the **two independent packages** topology. The root `package.json` has no
`workspaces` field, and both packages ship their own `package-lock.json`
(verified 2026-08-20). Do not represent the repo as a monorepo workspace, and
do not claim a single `npm install` at the root installs backend dependencies —
contributors must install in each package.

The verification command contract (`plans/decisions/0001-verification-command-contract.md`)
keeps direct `npm --prefix codevibes-backend` calls inside root-level scripts
so agents/contributors do not need to remember the topology.

## Consequences

- CI installs twice: `npm ci` (root) and `npm ci --prefix codevibes-backend`
  (see `.github/workflows/ci.yml`).
- Husky's `prepare` script at the root is sufficient to activate hooks repo-wide
  (it sets `core.hooksPath`); a developer who runs `npm install` only in
  `codevibes-backend/` will not activate hooks — README must say so.
- A future migration to npm workspaces would change this decision and the
  install instructions together; it requires a lockfile migration and is out of
  scope until its duplication savings are demonstrated.

## Supersedes / Superseded-by

- Supersedes: none
- Superseded-by: a workspaces-migration record if adopted.
