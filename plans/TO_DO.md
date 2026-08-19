# To Do

- explore and document how codevibes works end-to-end: how it selects which files to pass for review (priority categorization, ignore patterns, file caps) and what instructions go to the reviewing agent (priority-specific system prompts, output format). Produce a doc under `plans/` or `docs/` so future work (provider support, prompt tuning) has a written reference.
- expand support for other model providers — draft plan in `plans/model-provider-compatibility.md` (NEEDS REVIEW). Near-term scope: OpenAI-compatible APIs only (DeepSeek already speaks this); track broader expansion (Anthropic Messages, Google Gemini, AWS Bedrock, Cohere, xAI, ...) as follow-up work behind an adapter abstraction.
- expand support and pattern matching for other languages and greater variation
- resolve quality-gate warnings (oversized files: README.md, deepseekService.ts, sidebar.tsx, api.ts, AnalyzePage.tsx, HomePage.tsx; absolute-path reference in plans/quality-gates-hooks-ci.md), consider raising the 400-line cap where files are legitimately large, then make check-file-size blocking (run with --strict in CI/pre-commit)
