# 3. Orchestration & SSE — `codevibes-backend/src/services/analysisService.ts`

How one priority analysis is streamed to the frontend.

## Entry point

`analyzeRepository(res, repoUrl, apiKey, priority, effort, maxFilesPerPriority, githubToken?)`:

1. Parses and validates the GitHub repository, rejecting private repositories without a token.
2. Fetches the selected priority with the resolved `maxFilesPerPriority`. Progress produces
   `status` and `file` events.
3. A zero-file result emits `status` then `complete`, including the resolved effort, and ends.
4. Fetches are sent to the frozen legacy `deepseekService.streamAnalysis` path. `chunk` events
   are currently discarded; each completed issue is relayed as an `issue` event.
5. The service calculates server-side token usage and cost. For P1/P2 it fetches the next bucket
   with the same effective cap for `nextPriorityEstimate`.
6. It emits a `complete` event and always closes the response.

## Effort and file caps

`quick`, `standard`, and `thorough` are accepted effort values; a missing value defaults to
`standard`. Invalid body/query shapes are rejected before an SSE response begins.

- `MAX_FILES_PER_PRIORITY` is the strict positive-integer global hard cap (default `40`).
- `EFFORT_QUICK_MAX_FILES`, `EFFORT_STANDARD_MAX_FILES`, and
  `EFFORT_THOROUGH_MAX_FILES` default to `5`, `20`, and `40`.
- The effective cap is `min(layer cap, global cap)`. It applies to both live and next-priority
  fetches. An existing deployment using `MAX_FILES_PER_PRIORITY=20` safely limits thorough to 20.

`GET /api/estimate` returns `effort` and `maxFilesPerPriority`, allowing the client to explain an
administrator-limited selection.

## SSE event contract

Each payload is framed as `data: <JSON>\n\n`; the sender no-ops once the response ended.

- `status`: `{ message, filesScanned, totalFiles, currentFile? }`
- `file`: `{ path, priority, status: 'scanning' | 'complete' }`
- `issue`: normalized issue object
- `complete`: `{ priority, effort, filesScanned, issuesFound, tokensUsed, cost, nextPriorityEstimate? }`
- `error`: `{ message, code, retryable }`

### Event order

```text
status "Validating repository..."
status "Scanning <PriorityName> files..."
status "Fetching files... (n/total)" + file(scanning)   × per file
file(complete)                                          × per fetched file
status "Analyzing N files with AI..."
issue                                                   × per found issue
complete { priority, effort, filesScanned, issuesFound, tokensUsed, cost, nextPriorityEstimate? }
```

## Estimate

`getEstimate(repoUrl, effort, githubToken?)` validates the repository, counts categorized files,
then caps each bucket at the resolved effort cap. It still estimates `500` input tokens per file
and a `0.2` output ratio. It returns `AnalysisEstimate { repoInfo, effort, maxFilesPerPriority,
priority1, priority2, priority3, totalFiles, totalEstimatedTokens, totalEstimatedCost }`.

## Provider follow-up

This implementation changes **scope only**. With legacy routing active, its prompt and fixed
8000-token output limit are unchanged. Provider routing—not `deepseekService.ts`—must later own
effort-specific prompts, model-clamped output limits, and any revised estimate model while
preserving the JSON schema.
