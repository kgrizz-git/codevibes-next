# 4. The reviewing agent — `codevibes-backend/src/services/deepseekService.ts`

What instructions CodeVibes sends to the model, and how it parses the response.

## Endpoint & model
- `DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'` (`:14`).
- `MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat'` (`:17`).
  - `deepseek-chat` — faster, default.
  - `deepseek-reasoner` — more thorough but slower; may time out on large inputs.
- Generation params: `temperature: 0.3`, `max_tokens: 8000` (raised from 4000 to avoid
  truncation; `temperature` at `:728,804`, `max_tokens` at `:729,805`).

## Prompt selection
`getPromptForPriority(priority)` (`:633`) returns one of three hand-written system prompts.
All three demand **valid JSON only, no markdown**, and the same issue schema.

### Priority 1 — Security auditor (`:21`)
- Role: identify exploitable security vulnerabilities.
- 12 vuln classes: hardcoded secrets (with regex signatures for AWS/Stripe/GCP/OpenAI/Anthropic/
  Slack/GitHub/Private-Key/JWT/DB-URL + high-entropy assignments), authn/authz, SQL/NoSQL
  injection, command/code injection, XSS, path traversal, CORS misconfig, insecure crypto,
  sensitive data exposure, security misconfig, DoS, insecure deserialization.
- Severity vocabulary: **CRITICAL / HIGH / MEDIUM / LOW** with explicit definitions.
- False-positive guards: ignore `.env.example`, placeholders (`your_*`, `example.com`, etc.).
- Output schema extras: `severity ∈ {CRITICAL,HIGH,MEDIUM,LOW}`, `category` must match the
  vuln-type names above (e.g. "Hardcoded Secrets", "SQL Injection").

### Priority 2 — Bugs / performance / improvements (`:212`)
- Role: high-confidence bugs, perf, and high-impact improvements.
- **Strict gating**: report only if all three hold — (1) exact line reference, (2) WILL cause
  measurable problems, (3) clear unambiguous fix. No style/ESLint/"best practice" nits.
- 7 categories: bugs & logic errors, performance (N+1, indexes, O(n²), memory leaks, async,
  pooling), error handling, data integrity (transactions, consistency, validation, concurrency),
  resource leaks, API design flaws, high-impact improvements (measurable criteria only).
- Severity vocabulary: **HIGH / MEDIUM / LOW**.
- `category ∈ {bug, performance, error-handling, data-integrity, resource-leak, improvement}`.
- Demands measurable impact ("850ms… should be <50ms"), exact code references, working
  runnable `codeExample`.

### Priority 3 — Code quality (`:597`)
- Role: maintainability, readability, DX.
- Aspects: readability, DRY, organization, docs, modern practices, testability.
- **Severity restricted to MEDIUM | LOW**; TOP 5–10 most impactful; constructive not nitpicky.
- `category: "quality"`.

## Prompt assembly
- `formatFilesForPrompt(files)` (`:647`): joins files as
  `=== FILE: <path> ===\n<content>\n`.
- `userMessage` = `Analyze the following <n> files:\n\n<filesContent>` (`:707,783`).
- Request body: `{ model, messages:[{system},{user}], temperature:0.3, max_tokens:8000,
  stream?:true }` (`:722-731`, `:798-808`).

## Response parsing (defensive)
`parseIssuesFromResponse(response)` (`:656`):
- Strips a ```json fence if present (`:659`).
- `JSON.parse`; if `issues` isn't an array → return `[]` (`:664-666`).
- Normalizes each issue (`:669-684`):
  - `id = issue-<Date.now()>-<index>`
  - `severity` → one of `CRITICAL/HIGH/MEDIUM/LOW`, else `MEDIUM`.
  - `category` → one of `security/bug/performance/quality`, else `quality`.
  - `file` default `"unknown"`; `line` only if numeric.
  - `fix` falls back to `suggestedFix`; `codeExample` falls back to `code_example`.
- On any parse failure: log (first 500 chars) + return `[]` (`:685-688`).

## Non-streaming vs streaming
- `analyzeFiles(files, apiKey, priority)` (`:694`): single POST, reads `usage.prompt_tokens` /
  `completion_tokens` for actual token counts (falls back to estimates), returns
  `{ issues, inputTokens, outputTokens, cost }`.
- `streamAnalysis(files, apiKey, priority)` (`:775`) — async generator:
  - POST with `stream: true`; reads `response.body` reader (`:822`).
  - Decodes UTF-8, splits SSE `data:` lines (`:837`).
  -     Skips `[DONE]` via `continue` (`:842`); parses each `DeepSeekStreamChunk`;
    extracts `delta.content` (`:847`) and accumulates it into `fullContent` (`:856`), logs `reasoning_content` for reasoner (`:848-853`).
  - Yields `{type:'chunk', content}` per content delta (`:855-858`).
  - On `done`, parses `fullContent` → `issues`, estimates `outputTokens` + `cost`, yields
    `{type:'complete', issues, inputTokens, outputTokens, cost}` (`:868-879`).
- `validateApiKey(apiKey)` (`:885`): POST with `max_tokens:1`; `200` or `429` ⇒ valid.

## Known gaps (for the provider plan)
- **Missing `decoder.flush()`**: the loop `break`s on `done` (`:834`); `decoder.decode`
  is called with `{stream:true}` but `decoder.flush()` is never called (`:836`). Note `done`
  from `reader.read()` carries no data payload, so nothing is "dropped" on `done` — the real
  gap is any internally buffered incomplete multi-byte sequence being silently discarded. With
  self-contained `Uint8Array` chunks this is a theoretical edge case, but `flush()` is the
  correct best practice.
- `[DONE]` uses `continue` not `break` (`:842`) — harmless but inconsistent.
- `reasoning_content` is only logged, never returned to the client (`:848-853`).
- Pricing is hardcoded to DeepSeek (see `05-cost-model.md`); not provider-aware yet.

## Notes for downstream work (item 5: effort/detail layers)
- `getPromptForPriority` is the natural injection point for effort layers: a "quick" variant
  could append "be terse, report only CRITICAL/HIGH", a "thorough" variant could add depth.
- `max_tokens: 8000` (`:729,805`) is a single global; an effort layer may want to scale it.
- The enforced JSON schema is the contract the frontend renders — any prompt variant must keep it.
