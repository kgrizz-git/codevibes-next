# Agent Rules

## Git / GitHub

- **Always PR to the fork (`origin`), never to `upstream`.** This repo uses a fork-based workflow: `origin` = `kgrizz-git/codevibes-next` (your fork), `upstream` = `danish296/codevibes` (source repo). PRs go to `origin` by default. Never pass `--repo` to `gh pr create` unless explicitly told to.
- Run `gh pr create` without `--repo` — it defaults to the correct remote.
- Before pushing, verify the branch is on `origin` with `git remote -v`.

## Package Manager

- **npm.** Not bun. `bun.lockb` is deleted and gitignored.
- Prefer same-major security bumps and `overrides` for nested copies. Pin **to patched versions**, never to vulnerable ones. Scope overrides by parent package when a tree has multiple majors (do not use `minimatch@9` keys — npm 10 `ci` applies those to every `minimatch`, including already-patched 10.x). Do not take Dependabot grouped majors that jump **path-to-regexp** to 8.x (breaks Express 4), **react-router** to 7.x, **minimatch** 9→10, or **uuid** 13→14 unless that upgrade is explicitly requested.

## Security

- Credentialed CORS only reflects origins listed in `ALLOWED_ORIGINS` (default localhost/127.0.0.1 on 8080/5173/3000). Unlisted browser origins do not receive credentialed responses or `csrfToken` on `/api/health`. Requests with no `Origin` header (curl) still receive `csrfToken` in JSON but must send `X-CSRF-Token` on mutations. In local Vite, `/api` is proxied so CSRF cookies are first-party. Cookie-authenticated POST/PUT/PATCH/DELETE must send `X-CSRF-Token` matching `csrf_token` (curl: `GET /api/health` with `-c`/`-b` first). The SPA uses `withCsrfHeaders`. Never mint-and-accept a CSRF token on the same unsafe request.
