# 3. Orchestration & SSE — `codevibes-backend/src/services/analysisService.ts`

How a single priority analysis is driven end-to-end and streamed to the frontend.

## Entry point
`analyzeRepository(res, repoUrl, apiKey, priority, githubToken?)` (`:81`):

1. `parseGitHubUrl(repoUrl)` → on failure emit `INVALID_URL` and end (`:92-97`).
2. `validateRepo` → on failure emit `REPO_NOT_FOUND` and end (`:104-111`).
3. Private repo without token → emit `PRIVATE_REPO` and end (`:114-118`).
4. `getFilesForPriority(owner, repo, priority, MAX_FILES_PER_PRIORITY, onProgress, githubToken)`
   (`:123`). `onProgress` emits `status` ("Fetching files… (n/total)") and a `file` event
   (`scanning`) per file.
5. If zero files → emit `status` + `complete` with zeros, end (`:135-146`).
6. Emit a `file` event (`complete`) per fetched file (`:149-151`).
7. `deepseekService.streamAnalysis(files, apiKey, priority)` (`:161`) — async generator.
   - `chunk` events are currently discarded (placeholder for live token streaming) (`:164-166`).
   - `complete` → `totalInputTokens`, `totalOutputTokens`, `allIssues` (`:167-171`); each issue
     is relayed to the client as an `issue` SSE event (`:173-175`).
8. `calculateCost(input, output)` (`:179`); `totalTokens = in + out`.
9. If `priority < 3`: compute `nextPriorityEstimate` (`:183-195`):
   - `avgTokensPerFile = totalInputTokens / files.length || 500`
   - `estimatedTokens = nextFiles.files.length * avgTokensPerFile`
   - `estimatedCost = calculateCost(estimatedTokens, estimatedTokens * 0.2)`
10. Emit `complete` with `{ priority, filesScanned, issuesFound, tokensUsed, cost, nextPriorityEstimate }` (`:198-205`).
11. Errors → mapped to `INVALID_API_KEY` / `RATE_LIMITED` (retryable) / `ANALYSIS_ERROR` (`:218-227`).
    `finally { res.end() }` (`:228-230`).

## File cap
- `MAX_FILES_PER_PRIORITY = parseInt(process.env.MAX_FILES_PER_PRIORITY || '20', 10)` (`:23`).
  This caps how many files are **fetched and analyzed** per priority.

## SSE event contract
Helper senders (`:30-73`):
- `sendStatus(message, filesScanned, totalFiles, currentFile?)` → `{type:'status', data:{message, filesScanned, totalFiles, currentFile}}`.
- `sendFileEvent(path, priority, status)` → `{type:'file', data:{path, priority, status:'scanning'|'complete'}}`.
- `sendIssue(issue)` → `{type:'issue', data: IssueEventData}` (the normalized issue object).
- `sendComplete(data)` → `{type:'complete', data: CompleteEventData}`.
- `sendError(message, code, retryable?)` → `{type:'error', data:{message, code, retryable}}`.
- Wire format: `data: <JSON>\n\n` (`:34`); `sendSSE` no-ops if `res.writableEnded` (`:31`).

### Event ordering for one priority
```
status "Validating repository..."
status "Scanning <PriorityName> files..."
status "Fetching files... (n/total)" + file(scanning)   × per file
file(complete)                                          × per file
status "Analyzing N files with AI..."
issue                                                   × per found issue
complete { priority, filesScanned, issuesFound, tokensUsed, cost, nextPriorityEstimate? }
```

### Error codes
| Code | Trigger |
|---|---|
| `INVALID_URL` | URL doesn't match `github.com/owner/repo` |
| `REPO_NOT_FOUND` | `validateRepo` throws (404/403/...) |
| `PRIVATE_REPO` | repo is private and no `githubToken` |
| `INVALID_API_KEY` | DeepSeek 401 |
| `RATE_LIMITED` | DeepSeek 429 (retryable) |
| `ANALYSIS_ERROR` | any other analysis failure |

## Estimate (no analysis run)
`getEstimate(repoUrl, githubToken?)` (`:236`):
- Validates repo (private needs token, `:249-251`).
- `getCategorizedFileCounts` → counts per priority (`:254`).
- `AVG_TOKENS_PER_FILE = 500`, `OUTPUT_RATIO = 0.2` (`:257-258`).
- Per priority (capped at `MAX_FILES_PER_PRIORITY`): `tokens = files * 500`,
  `cost = calculateCost(tokens, tokens * 0.2)` (`:260-284`).
- Returns `AnalysisEstimate { repoInfo, priority1, priority2, priority3, totalFiles, totalEstimatedTokens, totalEstimatedCost }` (`:290-298`).

`validateRepository(repoUrl, githubToken?)` (`:304`) → thin wrapper returning `RepoInfo`.

## Notes for downstream work (item 5: effort/detail layers)
- `MAX_FILES_PER_PRIORITY` is already an env knob — an "effort layer" can scale it
  (e.g. quick=5, thorough=40) without code changes to the fetch path.
- The `nextPriorityEstimate` math and `getEstimate` both hardcode `500` / `0.2`; an effort layer
  that changes prompt depth should also adjust these so the UI estimate stays honest.
- `chunk` events are currently ignored (`:164-166`) — live token streaming is a natural
  enhancement hook.
