# To Do

- expand support and pattern matching for other languages and greater variation
- expand support for other model providers
- resolve quality-gate warnings (oversized files: README.md, deepseekService.ts, sidebar.tsx, api.ts, AnalyzePage.tsx, HomePage.tsx; absolute-path reference in plans/quality-gates-hooks-ci.md), consider raising the 400-line cap where files are legitimately large, then make check-file-size blocking (run with --strict in CI/pre-commit)
