# Plan: Pre-commit / Pre-push Hooks + CI Quality Gates

> **Status:** archived

> **Historical planning document** — a dated pre-implementation snapshot written
> 2026-08-18. All steps have since been implemented (hooks, lint, typecheck,
> tests, CI, security scans; see PR #8). The "Current state" line below
> describes the repo *before* that work and is intentionally not updated.

**Repo:** codevibes-next (Vite/React/TS frontend + `codevibes-backend` Express/TS)
**Current state:** No hooks. CI is only `upstream-check.yml`. No tests. ESLint exists **only at the root** — the backend has no ESLint config and no eslint devDependency, despite its `lint` script (`eslint src/**/*.ts`). Root `package.json` has **no `workspaces` field** — this is two independent packages, not a monorepo workspace setup.

**Pre-flight cleanup required:** `codevibes-backend/data/codevibes.db-shm` and `codevibes-backend/data/codevibes.db-wal` are tracked in git. The `.gitignore` only excludes `*.db` and `*.sqlite`. These SQLite WAL files are regenerated constantly and may contain query text with tokens. Before enabling `gitleaks detect`, add `codevibes-backend/data/*.db-shm` and `codevibes-backend/data/*.db-wal` to `.gitignore` and run `git rm --cached` to untrack them. Similarly, `bun.lockb` is tracked — `git rm bun.lockb` and add it to `.gitignore` (see npm decision below).

**Decision: npm.** Root has both `bun.lockb` and `package-lock.json`; backend has `package-lock.json` only. Delete `bun.lockb` — standardize on npm so both packages use the same lockfile format and CI only needs `actions/setup-node`.

---

## Current tool versions (verified 2026-08-18 — do not rely on memory, re-check before installing)

| Tool | Latest (verified) | Install / pin | Compatibility notes |
|---|---|---|---|
| husky | **9.1.7** | `npm i -D husky@^9.1.7` | Node >= 18 |
| lint-staged | **17.3.0** | `npm i -D lint-staged@^17.3.0` | **Node >= 22.22.1** — satisfied by Node 22 LTS; `.nvmrc` pins `22` (major) but CI should use `node-version: 22` which resolves to latest 22.x patch |
| vitest | **4.1.11** | `npm i -D vitest@^4.1.11` | **Requires Vite ^6\|\|^7\|\|^8 — repo has Vite ^5.4.19, so Step 5 includes a Vite 5→6 upgrade.** Node ^20\|\|^22\|\|>=24 |
| @vitest/coverage-v8 | **4.1.11** | must exactly match vitest version | — |
| eslint | 10.8.1 latest; repo on **^9.32.0** | keep 9.x unless choosing to migrate | typescript-eslint 8.67.0 supports eslint ^8.57\|\|^9\|\|^10, so both work |
| typescript-eslint | **8.67.0** | `npm i -D typescript-eslint@^8.67.0` | requires TypeScript < 6.1 — repo has 5.8.3 ✓ |
| eslint-plugin-import-x | **4.17.1** | `npm i -D eslint-plugin-import-x@^4.17.1` | drop-in replacement for `eslint-plugin-import` with proper ESLint 9 flat-config support; provides `import/no-absolute-path` |
| gitleaks | **v8.30.1** | `brew install gitleaks`; CI: download pinned binary from `github.com/gitleaks/gitleaks/releases/tag/v8.30.1`, verified against the release's official `gitleaks_8.30.1_checksums.txt` before extraction | ⚠️ Do NOT `npm i gitleaks` — the npm package is a squatter/placeholder, not the real tool |
| semgrep | **v1.173.0** | `brew install semgrep` (or `pipx`); CI: pin `semgrep/semgrep:1.173.0` Docker image | ⚠️ Do NOT `npm i semgrep` — the npm package is a squatter/placeholder, not the real tool |
| prettier | **3.9.6** | `npm i -D prettier@^3.9.6` | — |
| jsdom | **30.0.1** | `npm i -D jsdom@^30.0.1` | — |
| @testing-library/react | **16.3.2** | `npm i -D @testing-library/react@^16.3.2` | React ^18\|\|^19 — repo has 18.3.1 ✓ |
| @testing-library/jest-dom | **7.0.1** | `npm i -D @testing-library/jest-dom@^7.0.1` | — |

**Node strategy:** target **Node 22 LTS** in `.nvmrc` + CI — it's the active LTS (24 is Current until Oct 2026). Node 22 satisfies lint-staged 17 (>= 22.22.1), vitest 4 (^20\|\|^22\|\|>=24), and backend's declared >=18. Devs on Node 24 are fine (meets all constraints); plan to switch the standard to 24 when it enters LTS (Oct 2026).

---

## Recommended tooling (overview)

| Concern | Tool | Where it runs |
|---|---|---|
| Hook runner | **husky** + lint-staged | pre-commit / pre-push |
| Linting | ESLint (root only today — **Step 0 adds backend ESLint**) | pre-commit (staged), CI |
| Type checking | `tsc --noEmit` (per package, `-p <config>`) | pre-push, CI |
| Complexity / line limits | ESLint core rules + small custom script | pre-commit (staged), CI |
| Secret detection | **gitleaks** | pre-commit (staged), CI (history) |
| Tests + coverage | **Vitest** + `@vitest/coverage-v8` (frontend); Vitest or `node:test` for backend | pre-push (smoke), CI (full + thresholds) |
| Static security analysis | **semgrep** (native, no GH Action) | pre-commit (changed files), CI |
| Build verification | `vite build` + backend `tsc` build | pre-push, CI |
| Extra (optional) | Prettier, dependency audit, CodeQL, commitlint, PR-size guard | CI |

**Alternatives:** lefthook (single YAML config, no shell scripts, no `prepare` gotcha) instead of husky. `trufflehog` instead of gitleaks if you want GitHub-history scanning. `node:test` for backend unit tests — Vitest's Vite-native advantage only applies to the frontend; don't claim otherwise.

---

## Step 0 — Add ESLint to the backend (prerequisite)

**Recommendation: do this before any lint wiring. The backend `lint` script is currently broken (no config, no eslint installed).**

- `npm i -D eslint@^9 typescript-eslint@^8.67.0` in `codevibes-backend/` — match root's eslint 9.x major (eslint 10 exists but stay on 9 unless deliberately migrating; typescript-eslint 8.67.0 supports both).
- Add `codevibes-backend/eslint.config.js` — flat config, Node globals, `typescript-eslint` recommended.
- Fix the backend `lint` script: change `eslint src/**/*.ts` (shell glob — breaks on spaces, misses dotfiles) to `eslint src` (eslint's own globber respects the flat config's `files` array).
- Verify: `npm run lint` in `codevibes-backend` passes.

---

## Step 1 — Lint-staged + ESLint (pre-commit, fastest gate)

**Recommendation: do this first. Highest value, lowest friction.**

- Add `lint-staged@^17.3.0` to root devDependencies (requires Node >= 22.22.1 — see Node strategy above).
- **No workspaces exist, so use lint-staged's documented multi-package mechanism: a config file per package** (lint-staged resolves the *closest* config to each staged file and runs tasks from that config's directory — it does **not** merge configs). Root `lint-staged.config.js`:
  ```js
  // lint-staged.config.js (repo root)
  export default {
    '*.{ts,tsx}': 'eslint --fix',
    '*.{json,md,css}': 'prettier --write', // only if Prettier adopted (Step 9)
  }
  ```
  `codevibes-backend/lint-staged.config.js` (or `.lintstagedrc.json`):
  ```js
  // codevibes-backend/lint-staged.config.js
  export default {
    '**/*.ts': 'eslint --fix --config eslint.config.js',
  }
  ```
  Backend-staged files then use only the backend config; root files use the root config. ⚠️ **Do NOT put both `*.{ts,tsx}` and `codevibes-backend/**/*.ts` in one config object** — lint-staged runs tasks for *every* matching glob (no dedup; README warns of race conditions on overlapping patterns), so backend files would be linted twice: once with the root config (which has no backend-relevant rules), once with the backend config. Ordering does **not** fix this; non-overlap or per-directory configs do. ⚠️ **lint-staged resolves binaries from the closest `node_modules/.bin/` to the config file** — the backend `lint-staged.config.js` runs `eslint`, so Step 0 (backend eslint devDependency) must complete first or the task fails with "eslint: command not found".
- **Why `--config` is needed in the backend entry:** ESLint 9 flat-config resolution walks up from each linted file's directory — a backend file linted from the repo root would otherwise resolve the *root* `eslint.config.js`, not the backend one. `--config eslint.config.js` (relative to the config file's directory, where lint-staged runs the task — CWD is the config file's directory, not the git root) pins the right config.
- Only staged files are linted → fast. CI enforces the full repo.

### Absolute-path gate (pre-commit + CI)

**Recommendation: `eslint-plugin-import-x` (community fork with proper ESLint 9 flat-config support) with `import/no-absolute-path` (error), plus a grep in the file-size script.** The official `eslint-plugin-import` has notoriously lagging and buggy flat-config support — `eslint-plugin-import-x` is a drop-in replacement the ecosystem has adopted. The repo already has the `@/` alias in both `vite.config.ts` and `tsconfig.app.json` — the rule forces relative or `@/` imports and catches `/src/...`, `/Users/...`, and `http(s)://...` imports that would break under a subpath deployment or another machine:

```js
// root eslint.config.js (and backend flat config)
import importPlugin from 'eslint-plugin-import-x'
// ...
export default [
  // ...
  importPlugin.flatConfigs.recommended, // pulls in all import rules (no-unresolved, no-duplicates, no-cycle, order, etc.) — budget a cleanup pass if adopting; OR use the minimal config below for just the absolute-path gate:
  // { plugins: { import: importPlugin }, rules: { 'import/no-absolute-path': 'error' } },
  {
    rules: {
      'import/no-absolute-path': 'error',
    },
  },
]
```
Note: `eslint-plugin-import-x` has **no named `noAbsolutePath` export** — flat config imports the plugin default and references rules by string key.

- Pre-commit: rule runs via lint-staged on staged `*.ts/tsx`; the custom `check-file-size` node script additionally greps **staged non-TS files** (use `--diff-filter=ACMR` to exclude deleted files) for machine-specific absolute paths (`/Users/`, `/home/`, `C:\`) and fails.
- CI: whole repo, in the `quality` job.

---

## Step 2 — Husky hooks (pre-commit + pre-push wiring)

**Recommendation: husky v9.**

- `npm i -D husky@^9.1.7 && npx husky init` (installs, then creates `.husky/`) and **add `"prepare": "husky"` to root `package.json`** — without it, hooks never activate after `npm install` (husky v9 uses `core.hooksPath`; the `prepare` script is the activation step). Husky is **repo-global** (hooks live in `.git/hooks` via `core.hooksPath`), so the root `prepare` is sufficient even though the backend is a separate package. A developer who runs `npm install` only in `codevibes-backend/` will not trigger hook activation — document in the project README that `npm install` must be run from the repo root at least once.
- `pre-commit` hook — **gitleaks runs FIRST, before lint-staged mutates the index** (lint-staged `--fix` re-stages modified files; scanning post-fix content can miss/obscure patterns):
  ```sh
  gitleaks protect --staged
  npx lint-staged
  ```
- `pre-push` hook:
  ```sh
  npm run typecheck
  npx vitest run --changed HEAD~1  # frontend smoke; backend vitest lands later
  # npm --prefix codevibes-backend run test -- --changed HEAD~1  # uncomment when backend vitest lands (Step 5)
  ```
  ⚠️ gitleaks is intentionally omitted from pre-push. During a push, the staging area is empty (`--staged` scans nothing), and `protect` without `--staged` scans the entire working tree including untracked files. Pre-commit (`protect --staged`) + CI (`detect` on full history) cover both cases. If you want pre-push secret scanning, use `gitleaks protect --log-opts="$2..$1"` to scan the commit range being pushed (the hook receives `<local-ref> <local-sha> <remote-ref> <remote-sha>` on stdin).

  `vitest run --changed` compares against HEAD (committed state), not the working tree. On a fresh branch with no reachable ancestor or shallow history, it can **error** ("no previous commit") rather than pass vacuously. Use `--changed HEAD~1` as a safer default, or guard with `git rev-parse HEAD~1 >/dev/null 2>&1` before running. Pre-push is a smoke gate only; CI is the real safety net.
- **Per-tool flag cheat-sheet (no `--prefix` — that's npm-only):** eslint → `--config <path>`; tsc → `-p <tsconfig>`; vitest → `--config <path>` or `-c`; gitleaks → `--path <dir>`. Run hooks from repo root and reference configs by path.

---

## Step 3 — TypeScript typecheck (pre-push + CI)

**Recommendation: per-package `tsc --noEmit`.**

- Root script: `"typecheck": "tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p codevibes-backend/tsconfig.json"`.
- Backend `tsconfig.json` sets `declaration: true`, `declarationMap: true`, `sourceMap: true`, `outDir: ./dist`. `--noEmit` overrides these and is required — **never drop `--noEmit`** here, or tsc will emit declarations/source maps into `dist/` and pollute the tree.
- Cheap and catches real bugs — land it early (Step 2 in execution order).

---

## Step 4 — Secret detection: gitleaks (pre-commit + CI)

**Recommendation: gitleaks.**

- Install: `brew install gitleaks` (v8.30.1; devs). CI: download the **pinned binary** for v8.30.1 from GitHub releases (`gitleaks_8.30.1_<os>_<arch>.tar.gz`), not `latest` — pin exact versions in CI.
- Add `.gitleaks.toml` baseline so test fixtures/`.env.example` don't false-positive:
  ```toml
  # .gitleaks.toml
  [allowlist]
  paths = [".env.example", "codevibes-backend/data/", "tests/fixtures/"]
  ```
  (TOML uses double-quoted strings only.)
- **`protect` vs `detect` — they are NOT equivalent gates:** `gitleaks protect` scans working-tree changes (local-only; misses secrets already committed); `gitleaks detect` scans repo history (the real safety net, CI-only). Hooks use `protect`; CI must run `detect`.
- **Pre-flight: run `gitleaks detect` on current history before enabling it as a required CI check.** Triage findings — if secrets exist in history, remediate (rotate credentials, add `.gitleaksignore` for false positives) before making `detect` a blocking gate.

---

## Step 5 — Vitest + coverage thresholds (pre-push + CI)

**Recommendation: Vitest 4 for the frontend (Vite-native, jsdom + @testing-library/react). For the backend, Vitest with `node` environment is fine but so is `node:test` — don't assume Vitest is "fastest" there; the real backend complication is `better-sqlite3`.**

- **Prereq: upgrade Vite 5 → 6.** Vitest 4.1.11's peer range is `vite ^6||^7||^8`; the repo has `^5.4.19`. **Plugin compatibility verified:** `@vitejs/plugin-react-swc@3.11.0` (what the repo declares) peers `vite ^4||^5||^6||^7`, so the upgrade is safe — no plugin change needed. Make the Vite upgrade its own commit with a `vite build` smoke check before layering Vitest on top; don't bundle it with the Vitest install. If the Vite upgrade is not acceptable, fall back to vitest 3.x (Node ^18||^20||>=22) — but 4.x is the maintained current line.
- Install `vitest@^4.1.11` + `@vitest/coverage-v8@4.1.11` (must match vitest's version exactly) + `jsdom@^30.0.1` + `@testing-library/react@^16.3.2` + `@testing-library/jest-dom@^7.0.1` (frontend).

- Frontend: dedicated `vitest.config.ts` using `mergeConfig` — a standalone `vitest.config.ts` **overrides** (not merges) the Vite config, so merge explicitly or you lose the `@` alias and plugins:
  ```ts
  // vitest.config.ts
  import { defineConfig, mergeConfig } from 'vitest/config'
  import viteConfig from './vite.config'
  export default mergeConfig(viteConfig, defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./vitest.setup.ts'],
    },
  }))
  ```
  ```ts
  // vitest.setup.ts
  import '@testing-library/jest-dom/vitest'
  ```
  Without the setup file, `expect(...).toBeInTheDocument()` and other jest-dom matchers are undefined.
  (Alternative: add a `test` property directly inside `vite.config.ts` — works, but mixes build and test concerns.)
- Backend: vitest `node` environment. **`better-sqlite3` needs native bindings and a DB file** — tests touching DB logic must use in-memory SQLite (`:memory:`) or fixtures/mocking. Plan test fixtures and a `setup.ts` before writing DB tests; don't hand-wave this. Add `"test": "vitest run"` to `codevibes-backend/package.json` (currently has no `test` script — CI `test` job will fail without it).
- Coverage config — **correct key is `coverage.thresholds` (plural)**. Each package needs its own `include` — the frontend config covers `src/**/*.{ts,tsx}`, the backend config covers its own `src/`:
  ```ts
  // in each package's vitest.config.ts
  coverage: {
    provider: 'v8',
    reporter: ['text', 'json-summary'],
    include: ['src/**/*.{ts,tsx}'],  // relative to each package root
    thresholds: { lines: 0, functions: 0, branches: 0, statements: 0 }, // start at 0!
  }
  ```
- **Threshold strategy: start at 0 (or omit) — there are zero tests today, so any positive threshold fails the first PR.** Ratchet up after a meaningful suite exists; use `thresholds.autoUpdate: true` locally to ratchet automatically, or raise ~5%/sprint manually.
- Pre-push: `vitest run --changed` — **only works with git history; requires `fetch-depth: 0` anywhere shallow clones exist (CI)**. Never use `--changed` in CI; CI runs full suite with coverage. Note: `--changed` compares against HEAD (committed state), not the full working tree — uncommitted changes are not included. This is fine for a smoke gate but is not a correctness guarantee; CI is the real safety net.

---

## Step 6 — Static security analysis: semgrep (pre-commit + CI)

**Recommendation: semgrep OSS, run natively. Do NOT use `returntocorp/semgrep-action` or `semgrep/semgrep-action` — both are deprecated; current guidance is native `semgrep ci` / `semgrep scan` (see semgrep.dev/docs).**

- Local: `brew install semgrep` (v1.173.0). Keep local and CI versions aligned.
- **No built-in `--changed-files` flag — pass changed files explicitly. Command substitution (`$(git diff …)`) breaks on filenames with spaces, so use `-z`/`-0` (NUL-safe) with an empty guard — `xargs -r` is GNU-only, don't rely on it on macOS. Use `--diff-filter=ACMR` to exclude deleted files (passing a deleted path to semgrep causes "File not found"):**
  ```sh
  if git diff --cached --name-only --diff-filter=ACMR -- '*.ts' '*.tsx' | grep -q .; then
    git diff --cached -z --name-only --diff-filter=ACMR -- '*.ts' '*.tsx' | xargs -0 semgrep scan --config p/typescript --config p/javascript
  fi
  ```
- CI: `semgrep ci` — for diff-aware PR scanning set the baseline explicitly (only on PRs; `github.event.pull_request` is undefined on `push` events):
  ```yaml
  env:
    SEMGREP_BASELINE_REF: ${{ github.event.pull_request.base.sha || github.event.before }}
  ```
  `github.event.before` provides the previous HEAD SHA on `push` events, giving a reasonable baseline. Without a baseline, `semgrep ci` scans the whole repo and surfaces legacy findings. Alternative: a **pinned `semgrep/semgrep:1.173.0`** Docker image with `p/security-audit` + `p/typescript` + `p/javascript`. Version-pin rules in a checked-in `semgrep.yml` if you want zero external drift. Bump the semgrep pin deliberately (release cadence is ~weekly), not silently via `latest`.
- Block on errors; start findings as warnings to avoid first-week friction.

---

## Step 7 — Complexity + file line count gates (pre-commit + CI)

**Recommendation: ESLint core rules + a tiny custom script.**

- All five rules (`complexity`, `max-lines-per-function`, `max-depth`, `max-nested-callbacks`, `max-lines`) are **ESLint core rules — but none are enabled by `typescript-eslint` recommended configs**, so they must be added manually to the flat config in both packages. ⚠️ **Flat config (eslint.config.js) has no `overrides` key — that's legacy `.eslintrc` syntax and is silently ignored.** Use multiple config objects in the exported array:
  ```js
  // eslint.config.js — flat config style
  export default [
    // ...existing configs (typescript-eslint recommended, etc.)
    {
      files: ['**/*.{ts,tsx}'],
      rules: {
        complexity: ['warn', 10],
        'max-depth': ['warn', 4],
        'max-lines-per-function': ['warn', 80],
        'max-nested-callbacks': ['warn', 3],
        'max-lines': ['warn', { max: 300 }],
      },
    },
    {
      files: ['**/*.test.{ts,tsx}', '**/*.config.{js,ts}'],
      rules: { 'max-lines': 'off' },
    },
  ]
  ```
- Custom script `scripts/check-file-size.sh` (node script preferred): fail on any file > 400 lines (excluding configs/fixtures/tests). Runs on **staged files** in pre-commit, **whole repo** in CI.
- Before enabling: measure the 95th percentile of current file lengths; set initial thresholds there or budget a cleanup commit, or the first run fails on existing code.
- **Flip to `error`**: once a cleanup commit lands and the 95th percentile is below the thresholds, change `warn` → `error` in a follow-up commit. Until then, complexity rules are advisory only and don't gate merges.

---

## Step 8 — CI workflow (GitHub Actions, `ci.yml`)

**Recommendation: GitHub Actions; repo already has `.github/workflows`. One workflow, grouped jobs to keep minutes down.**

Shared setup: `actions/checkout` with **`fetch-depth: 0`** (needed if any job uses git-aware scans), **Node 22 LTS**. Correct setup:
```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
- uses: actions/setup-node@v4
  with:
    node-version: 22
    cache: 'npm'
    cache-dependency-path: |
      package-lock.json
      codevibes-backend/package-lock.json
- run: npm ci
- run: npm ci --prefix codevibes-backend
```
`actions/setup-node` has **built-in npm caching** (`cache: 'npm'`) — `cache-dependency-path` accepts a list so both lockfiles are keyed. Also create `.nvmrc` (`22`) in the repo root so local dev matches CI.

**Grouped jobs (lighter than 8 separate checks — branch protection requires 4):**

| Job | Contents |
|---|---|
| `quality` | lint (root + backend) + `tsc --noEmit` both packages — use separate named steps so the Actions UI shows which failed: `- name: Lint` / `- name: Typecheck` |
| `test` | `npx vitest run --coverage` (root/frontend) + `npm --prefix codevibes-backend run test -- --coverage` (each with its own `vitest.config.ts` and `coverage.include`) |
| `build` | `vite build` + backend `tsc` build |
| `security` | gitleaks `detect` (full history) + semgrep `ci` |

Branch protection: require all 4 jobs to pass on PRs. That's 4 required checks, not 8.

---

## Step 9 — Optional extras (recommended after core gates are green)

| Extra | Tool | Notes |
|---|---|---|
| Formatting | Prettier 3.9.6 | Single source of truth; `--write` in lint-staged, `--check` in CI; one-time format-all commit. |
| Dependency audit | `npm audit` | CI job, fail on high/critical only. |
| Commit message lint | commitlint + `@commitlint/config-conventional` | Only if you adopt conventional commits. |
| PR size guard | custom action/script | Fail PRs > 30 files / > 1000 lines. |
| Lockfile hygiene | delete `bun.lockb` from root | Standardize on npm (see top-of-plan). |
| Branch protection | GitHub settings | Code gates don't block merges unless enabled. |

---

## Execution order (recommended sequencing)

1. **Step 0** — backend ESLint config + devDeps (unblocks lint wiring).
2. **Pre-flight cleanup** — untrack SQLite WAL/SHM files (`git rm --cached codevibes-backend/data/*.db-shm codevibes-backend/data/*.db-wal`), add to `.gitignore`, delete and ignore `bun.lockb`. Commit before enabling `gitleaks detect`.
3. **Step 1** — lint-staged + ESLint (pre-commit).
4. **Step 3** — typecheck: add the root script + run it locally (pre-push hook lands with Step 2; it also rides in the CI `quality` job — no separate CI work needed).
5. **Step 8 skeleton** — CI `quality` + `build` jobs so CI exists from day one.
6. **Step 2** — husky wiring (pre-commit: gitleaks → lint-staged; pre-push: typecheck + smoke tests) + `prepare` script.
7. **Step 4** — gitleaks (hooks + CI `detect` job). Run `gitleaks detect` on existing history first; triage or remediate findings before making it a required check.
8. **Step 7** — complexity/line limits (staged → whole repo). Rules start as `warn`; flip to `error` after cleanup commit.
9. **Step 5 (Vite upgrade)** — Vite 5→6 as its own commit; smoke-test `vite build` before proceeding.
10. **Step 5 (Vitest)** — Vitest + coverage (no test infra exists; backend needs in-memory SQLite/fixtures).
11. **Step 6** — semgrep.
12. **Step 9** — extras.

## Open decisions to confirm

- [ ] **Node standard: 22 LTS now (recommended) → 24 when it hits LTS (Oct 2026)**
- [x] **Package manager: npm — delete `bun.lockb` from root**
- [ ] **eslint: stay on 9.x (recommended, zero migration) vs upgrade to 10.8.1**
- [ ] **Vite 5→6 upgrade required for vitest 4 (recommended) vs vitest 3.x fallback**
- [ ] husky vs lefthook as hook runner
- [ ] Backend test framework: Vitest vs `node:test`
- [ ] Coverage ratchet: `autoUpdate` vs manual 5%/sprint (threshold starts at 0 regardless)
- [ ] Complexity limit 10 vs 12 — measure current code first; rules default to `warn` in snippet, flip to `error` after cleanup
- [ ] semgrep rules: registry packs vs versioned `semgrep.yml`
- [ ] Adopt Prettier or not
