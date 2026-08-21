# Plan C (Item 5) — Documentation and Contract Maintenance

> status: accepted
> **Review state:** mandatory completion work for every Plan A/B pull request.

## Rule

The review-pipeline reference is source-of-truth documentation, not post-merge cleanup. A PR that
changes pipeline behavior updates its documentation and generated contract in the same PR. Static
`file:line` references must be accurate at merge time; do not plan a routine follow-up to repair
them.

## Mapping

| Change | Required updates |
|---|---|
| Extensions, ignore rules, priority rules, classifier decision metadata | `02-file-selection.md`, `06-extension-hooks.md`; regenerate contract if P3 extensions change |
| File-cap resolver, effort validation, estimates, complete payload, scope metadata | `03-orchestration-sse.md`, pipeline index, `.env.example`; `05-cost-model.md` when estimation inputs/assumptions change |
| Prompt variants, provider/model token limits, schema, truncation behavior | `04-reviewing-agent.md`, `06-extension-hooks.md`, pipeline index |
| Stored effort/history behavior | API/history documentation and the relevant user-facing history text; provider-plan schema notes if migrations are coordinated |
| New pipeline source module | add it to `MAPPINGS` in `scripts/check-review-pipeline-docs.mjs` with its primary human-maintained page before relying on the check |

`MAPPINGS` can enforce one primary page only. Where a change needs multiple pages (as effort does),
the PR checklist and review must enforce the remaining pages; do not claim the script proves all
documentation was updated.

## Generated contract

`scripts/review-pipeline-contract.mjs` extracts literal P3 extensions and policy arrays from
`fileFilter.ts`, global and effort-cap defaults from `config/effort.ts`, estimate constants, and
legacy generation parameters. A classifier/cap/provider refactor can make it throw or report
incomplete data rather than merely make `generated-contract.md` stale. Update the generator first
in the same PR so it extracts the new canonical configuration and labels layer-dependent facts
unambiguously.

Then run and commit the result:

```sh
npm run docs:pipeline-contract
npm run check:pipeline-contract
npm run check:pipeline-docs
```

## PR checklist

1. Update the mapped prose pages and all changed wire types/examples.
2. Update `.env.example` whenever a server setting changes, including validation and migration
   semantics—not only its name/default.
3. Regenerate the source contract and update its generator if extraction assumptions changed.
4. Run documentation checks plus `npm run check:structure` (the valid structural gate; there is no
   `scripts/check-file-size --strict` command).
5. Review the rendered docs for stale line references and contract values before merge.
