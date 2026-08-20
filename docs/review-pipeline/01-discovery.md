# 1. Discovery — `codevibes-backend/src/services/githubService.ts`

How CodeVibes turns a GitHub URL into a set of file contents ready for analysis.

## URL parsing
- `parseGitHubUrl(url)` (`githubService.ts:17`) uses the module-level `GITHUB_URL_REGEX` (`githubService.ts:12`, referenced at `:18`) matching `github\.com\/([^/]+)\/([^/]+)`.
  - Strips a trailing `.git` (`:27`).
  - Keeps only the first path segment / strips query & fragment (`:32`): `repo.split('/')[0].split('?')[0].split('#')[0]`.
  - Returns `{ owner, repo }` or `null`.

## Repo validation
- `validateRepo(owner, repo, token?)` (`:53`) calls `octokit.repos.get` and returns `RepoInfo`
  (fullName, description, stars, language, lastUpdate, defaultBranch, isPrivate).
- Auth: `createOctokit(token)` (`:41`) uses the passed `token`, else `process.env.GITHUB_TOKEN`.
  User OAuth tokens enable private-repo access; the env token just raises rate limits.
- Errors mapped: `404` → "Repository not found", `403` → rate limit, else generic.

## File tree (single API call + cache)
- `getFileTree(owner, repo, branch?, token?)` (`:96`):
  - Cache key `owner/repo/branch|default`; in-memory `fileTreeCache` with `CACHE_TTL = 5*60*1000` (`:82-83`).
    On hit, logs and returns cached `FileEntry[]` (`:100-104`).
  - Resolves `targetBranch` from arg or `validateRepo(...).defaultBranch` (`:110`).
  - One recursive Tree API call: `octokit.git.getTree({ tree_sha: targetBranch, recursive: 'true' })` (`:113`).
  - Filters to blobs only (`item.type === 'blob' && path && sha`), maps to
    `{ path, type:'file', size, sha }` (`:121-128`).
  - Caches and returns (`:133`).
- Errors: `404` → not found, `409` → empty repo.

## File content
- `getFileContent(owner, repo, path, token?)` (`:150`): `repos.getContent`, base64-decodes
  `data.content` to UTF-8 (`:175`). Throws on directory / non-file / `404`.
- `getFilesContents(paths, maxFiles=20, onProgress?, token?)` (`:194`):
  - Slices to `maxFiles` (`:203`).
  - **Parallel batches of 5** (`BATCH_SIZE = 5`, `:208`): each batch maps to concurrent
    `getFileContent` promises, `Promise.all`, then a 200ms delay before the next batch (`:246`, inside the `:212-248` batch loop).
  - Per-file failures are logged and skipped — they do **not** abort the batch (`:220-223`).
  - Calls `onProgress(processed, total, path)` per file (`:239-241`).
  - Returns successfully-fetched `FileContent[]` (`:235`).

## Priority-scoped helpers
- `getFilesForPriority(priority, maxFiles=20, onProgress?, token?)` (`:258`):
  tree → `filterFilesByPriority` → `getFilesContents`. Returns `{ files, totalMatching }`.
  `totalMatching` is the **uncapped** count of matching files (used for estimates).
- `getCategorizedFileCounts(owner, repo, token?)` (`:287`): tree → `categorizeFiles` →
  `{ priority1, priority2, priority3, ignored, total }`. Used by `getEstimate`.

## Notes for downstream work
- The 5-min tree cache is per-process and not invalidated by new pushes; fine for analysis,
  but a "re-scan" UI would need a cache-clear affordance (`clearFileTreeCache`, `:88`).
- `maxFiles` default (20) is the cap applied **before** fetching; the estimate uses the
  **uncapped** `totalMatching` (see `03-orchestration-sse.md`).
