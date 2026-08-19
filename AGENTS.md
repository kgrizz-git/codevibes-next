# Agent Rules

## Git / GitHub

- **Always PR to the fork (`origin`), never to `upstream`.** This repo uses a fork-based workflow: `origin` = `kgrizz-git/codevibes-next` (your fork), `upstream` = `danish296/codevibes` (source repo). PRs go to `origin` by default. Never pass `--repo` to `gh pr create` unless explicitly told to.
- Run `gh pr create` without `--repo` — it defaults to the correct remote.
- Before pushing, verify the branch is on `origin` with `git remote -v`.

## Package Manager

- **npm.** Not bun. `bun.lockb` is deleted and gitignored.
