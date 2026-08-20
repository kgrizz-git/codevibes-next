# CodeVibes Review Pipeline — End-to-End Reference

> **Purpose:** Written reference for how CodeVibes selects files for review and what
> instructions it sends to the reviewing agent. This is **item 1** of `plans/TO_DO.md`.
> It unblocks future work: multi-provider support (`plans/model-provider-compatibility.md`),
> prompt tuning, and **broader language & pattern coverage with selectable effort/detail
> layers** (`plans/TO_DO.md` item 5, sequenced to run immediately after this doc).
>
> **Scope:** Documentation only. No code changes. `deepseekService.ts` stays byte-for-byte
> intact (legacy-provider constraint, TO_DO item 6 / provider plan Step 1).
>
> **Verified against source on 2026-08-20** (file:line references are checkable).

## Pipeline at a glance

```
GitHub URL
   │  githubService.parseGitHubUrl
   ▼
RepoInfo  ── validateRepo
   │
   ▼  githubService.getFileTree        (1 Tree API call, 5-min cache)
File[]  ── fileFilter.categorizeFiles  (ignore + P1/P2/P3 first-match-wins)
   │
   ▼  githubService.getFilesForPriority + getFilesContents
FileContent[]  (parallel batches of 5, maxFiles = MAX_FILES_PER_PRIORITY, default 20)
   │
   ▼  analysisService.analyzeRepository
   │     └─ deepseekService.streamAnalysis  (SSE to DeepSeek, temperature 0.3, max_tokens 8000)
   │           └─ getPromptForPriority(p)  → hand-written system prompt
   ▼
SSE events → AnalyzePage:  status · file · issue · complete · error
```

## Linked pages

- [1. Discovery — `githubService.ts`](./review-pipeline/01-discovery.md)
- [2. File selection — `fileFilter.ts`](./review-pipeline/02-file-selection.md)
- [3. Orchestration & SSE — `analysisService.ts`](./review-pipeline/03-orchestration-sse.md)
- [4. The reviewing agent — `deepseekService.ts`](./review-pipeline/04-reviewing-agent.md)
- [5. Cost model — `tokenCounter.ts`](./review-pipeline/05-cost-model.md)
- [6. Extension hooks (forward-looking)](./review-pipeline/06-extension-hooks.md)
- [Generated source contract](./review-pipeline/generated-contract.md) — machine-checked
  limits, pricing, extensions, and event names

## Key facts (quick reference)

| Concern | Value / Location |
|---|---|
| File cap per priority | `MAX_FILES_PER_PRIORITY` = `process.env.MAX_FILES_PER_PRIORITY \|\| 20` (`analysisService.ts:23`) |
| Parallel fetch | batches of 5, 200ms gap between batches (`githubService.ts:208,246`) |
| Tree cache | in-memory, 5 min TTL (`githubService.ts:82-83`) |
| Priority model | ignore → P1 (security) → P2 (business) → P3 (supporting), first match wins (`fileFilter.ts:244`) |
| Matcher | `minimatch` with `{ dot: true, matchBase: true }` (`fileFilter.ts:229`) |
| Agent model | `process.env.DEEPSEEK_MODEL \|\| 'deepseek-chat'` (`deepseekService.ts:17`) |
| Generation params | `temperature: 0.3`, `max_tokens: 8000` (`temperature` at `deepseekService.ts:728,804`, `max_tokens` at `:729,805`) |
| Output contract | JSON only, no markdown; issue schema `{severity, category, file, line, title, description, impact, fix, codeExample}` |
| Cost estimate | `ceil(len/4)` tokens; DeepSeek `deepseek-chat` pricing `0.14` in / `0.28` out per 1M (`tokenCounter.ts:7,10-11`) |
| Token budget for estimate | `AVG_TOKENS_PER_FILE = 500`, `OUTPUT_RATIO = 0.2` (`analysisService.ts:257-258`) |

## Known gaps (captured so downstream plans can fix them)

- **SSE streaming never calls `decoder.flush()`** after the read loop (`deepseekService.ts:831-863`). `done` from `reader.read()` carries no data payload, so nothing is literally "dropped" on `done`; the real gap is that any internally buffered incomplete multi-byte sequence from the final `decoder.decode(value, {stream:true})` is silently discarded. With self-contained `Uint8Array` chunks this is a theoretical edge case, but best practice is to `flush()` — tracked for fix in the provider plan's SSE section.
- `[DONE]` is handled via `continue` rather than `break` (`deepseekService.ts:842`).
- Cost pricing is **hardcoded** to DeepSeek `deepseek-chat` (`tokenCounter.ts:10-11`); not provider-aware yet (provider plan adds `pricingStatus`/`costBasis`).
- `deepseek-reasoner` is selectable via `DEEPSEEK_MODEL` but its `reasoning_content` is only logged, never surfaced (`deepseekService.ts:848-853`).
