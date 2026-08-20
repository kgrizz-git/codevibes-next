# Agent Rules

## Git / GitHub

- **Always PR to the fork (`origin`), never to `upstream`.** This repo uses a fork-based workflow: `origin` = `kgrizz-git/codevibes-next` (your fork), `upstream` = `danish296/codevibes` (source repo). PRs go to `origin` by default. Never pass `--repo` to `gh pr create` unless explicitly told to.
- Run `gh pr create` without `--repo` — it defaults to the correct remote.
- Before pushing, verify the branch is on `origin` with `git remote -v`.

## Package Manager

- **npm.** Not Bun. The obsolete Bun lockfile is deleted and ignored.
- Prefer same-major security bumps and `overrides` for nested copies. Pin **to patched versions**, never to vulnerable ones. Scope overrides by parent package when a tree has multiple majors (do not use `minimatch@9` keys — npm 10 `ci` applies those to every `minimatch`, including already-patched 10.x). Do not take Dependabot grouped majors that jump **path-to-regexp** to 8.x (breaks Express 4), **react-router** to 7.x, **minimatch** 9→10, or **uuid** 13→14 unless that upgrade is explicitly requested.

## Security

- Credentialed CORS only reflects origins listed in `ALLOWED_ORIGINS` (default localhost/127.0.0.1 on 8080/5173/3000). Unlisted browser origins do not receive credentialed responses or `csrfToken` on `/api/health`. Requests with no `Origin` header (curl) still receive `csrfToken` in JSON but must send `X-CSRF-Token` on mutations. In local Vite, `/api` is proxied so CSRF cookies are first-party. Cookie-authenticated POST/PUT/PATCH/DELETE must send `X-CSRF-Token` matching `csrf_token` (curl: `GET /api/health` with `-c`/`-b` first). The SPA uses `withCsrfHeaders`. Never mint-and-accept a CSRF token on the same unsafe request.

## Documentation / Pipeline Reference

- The analysis pipeline is documented in `docs/review-pipeline/` (index: `docs/review-pipeline.md`). The pages cover file selection (`fileFilter.ts`), discovery (`githubService.ts`), orchestration & SSE (`analysisService.ts`), the reviewing agent (`deepseekService.ts`), the cost model (`tokenCounter.ts`), and a forward-looking extension-hooks page.
- **Keep these docs in sync with the code.** Whenever you change the review pipeline — file-selection rules, ignore/priority patterns, the GitHub fetch or SSE flow, the agent prompts or their JSON schema, generation params (`temperature`/`max_tokens`), cost/pricing logic, or the `MAX_FILES_PER_PRIORITY` knob — update the corresponding `docs/review-pipeline/` page. Treat them as the spec; see the **"Broader language & pattern coverage"** heading in `plans/TO_DO.md` (the entry that runs immediately after the pipeline reference) — that work explicitly depends on these docs.
- `deepseekService.ts` must stay byte-for-byte intact until `USE_LEGACY_PROVIDER` is retired (see the **"resolve quality-gate warnings … deepseekService.ts exception"** entry in `plans/TO_DO.md` and provider plan Step 1) — document changes there rather than editing the file. The structural line-limit policy and this legacy exception are recorded in `plans/decisions/0003-structural-line-policy.md`.
