# Decision Records

Accepted, durable choices for the agent harness, verification commands, and
repository maintenance. Owned by the documentation/agent-guidance workstream
(see `plans/harness-engineering.md`).

Records live here (not a top-level `docs/decisions/`) so `plans/` keeps three
clear classes: active plans at its root, accepted decisions in `plans/decisions/`,
and historical research/plans in `plans/archive/`.

Each record is `NNNN-kebab-case.md` with: status, context, decision,
consequences, and supersedes/superseded-by links.

## Records

| # | Title | Status |
|---|-------|--------|
| 0001 | [Verification command contract](./0001-verification-command-contract.md) | Accepted |
| 0002 | [Package topology: two independent npm packages](./0002-package-topology.md) | Accepted |
| 0003 | [Structural line-limit policy and legacy exception](./0003-structural-line-policy.md) | Accepted |
| 0004 | [Targeted coverage policy and ratchet](./0004-coverage-ratchet.md) | Accepted |

## Review cadence

Policies likely to change (Node standard, command contract, coverage floors)
carry an explicit **review date** in their record. A scheduled, non-blocking
maintenance check flags records past their review date (see
`plans/harness-engineering.md` Phase 5).
