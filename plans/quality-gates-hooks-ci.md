# Plan: Pre-commit / Pre-push Hooks + CI Quality Gates

**Repo:** codevibes-next (Vite/React/TS frontend + `codevibes-backend` Express/TS)
**Current state:** No hooks. CI is only `upstream-check.yml`. No tests. ESLint exists **only at the root** — the backend has no ESLint config and no eslint devDependency, despite its `lint` script (`eslint src/**/*.ts`). Root `package.json` has **no `workspaces` field** — this is two independent packages, not a monorepo workspace setup.

**Revision note:** incorporates review `tmp/quality-gates-review-2026-08-18.md`. Two review claims were checked and rejected: (a) root `.gitignore` *did* ignore `*.md` (verified via `git show HEAD:.gitignore`); the block was removed from root and backend, so `plans/` is trackable. (b) The "fix" to `semgrep/semgrep-action` is itself deprecated — the correct current approach is **native semgrep** (`semgrep ci`), no action wrapper at all. (c) Vitest coverage key is correctly `coverage.thresholds` (plural) per vitest.dev docs; the review's "singular `threshold`" claim is wrong.

> ⚠️ **Package-manager decision needed before CI work:** root has **both** `bun.lockb` and `package-lock.json`; backend has `package-lock.json`. Pick **bun** (faster, already present at root) and delete both `package-lock.json` files, or standardize on npm. Don't leave both — they can diverge and CI will resolve differently than local.

---

## Current tool versions (verified 2026-08-18 — do not rely on memory, re-check before installing)

| Tool | Latest (verified) | Install / pin | Compatibility notes |
|---|---|---|---|
| husky | **9.1.7** | `npm i -D husky@^9.1.7` | Node >= 18 |
| lint-staged | **17.3.0** | `npm i -D lint-staged@^17.3.0` | **Node >= 22.22.1** — repo has no `.nvmrc`; add one (`24`) so devs/CI meet this |
| vitest | **4.1.11** | `npm i -D vitest@^4.1.11` | **Requires Vite ^6\|\|^7\|\|^8 — repo has Vite ^5.4.19, so Step 5 includes a Vite 5→6 upgrade.** Node ^20\|\|^22\|\|>=24 |
| @vitest/coverage-v8 | **4.1.11** | must exactly match vitest version | — |
| eslint | 10.8.1 latest; repo on **^9.32.0** | keep 9.x unless choosing to migrate | typescript-eslint 8.67.0 supports eslint ^8.57\|\|^9\|\|^10, so both work |
| typescript-eslint | **8.67.0** | `npm i -D typescript-eslint@^8.67.0` | requires TypeScript < 6.1 — repo has 5.8.3 ✓ |
| eslint-plugin-import | **2.32.0** | `npm i -D eslint-plugin-import@^2.32.0` | provides `import/no-absolute-path`; **peers eslint ≤ 9 only** — blocks eslint 10 upgrade until plugin ships support |
| gitleaks | **v8.30.1** | `brew install gitleaks`; CI: download pinned binary from `github.com/gitleaks/gitleaks/releases/tag/v8.30.1` | — |
| semgrep | **v1.173.0** | `brew install semgrep` (or `pipx`); CI: pin `semgrep/semgrep:1.173.0` Docker image | — |
| prettier | **3.9.6** | `npm i -D prettier@^3.9.6` | — |
| jsdom | **30.0.1** | `npm i -D jsdom@^30.0.1` | — |
| @testing-library/react | **16.3.2** | `npm i -D @testing-library/react@^16.3.2` | React ^18\|\|^19 — repo has 18.3.1 ✓ |
| @testing-library/jest-dom | **7.0.1** | `npm i -D @testing-library/jest-dom@^7.0.1` | — |
| bun | **1.3.14** | CI: `oven-sh/setup-bun` with `bun-version: 1.3.14` | Node 24 for runtime if mixed |

**Node strategy:** target **Node 24** in `.nvmrc` + CI (`actions/setup-node node-version: 24`) — satisfies lint-staged 17 (>=22.22.1), vitest 4 (^20\|\|^22\|\|>=24), and backend's declared >=18.

---

## Recommended tooling (overview)

| Concern | Tool | Where it runs |
|---|---|---|
| Hook runner | **husky** + lint-staged | pre-commit / pre-push |
| Linting | ESLint (root only today — **Step 0 adds backend ESLint**) | pre-commit (staged), CI |
| Type checking | `tsc --noEmit` (per package, `-p <config>`) | pre-push, CI |
| Complexity / line limits | ESLint core rules + small custom script | pre-commit (staged), CI |
| Secret detection | **gitleaks** | pre-commit (staged), pre-push, CI |
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
- Verify: `npm run lint` in `codevibes-backend` passes.

---

## Step 1 — Lint-staged + ESLint (pre-commit, fastest gate)

**Recommendation: do this first. Highest value, lowest friction.**

- Add `lint-staged@^17.3.0` to root devDependencies (requires Node >= 22.22.1 — see Node strategy above).
- `lint-staged.config.js` — **no workspaces exist, so map per-path explicitly**:
  ```js
  export default {
    '*.{ts,tsx}': 'eslint --fix',
    'codevibes-backend/**/*.ts': 'eslint --fix --config codevibes-backend/eslint.config.js',
  }
  ```
  (Order matters: the more specific `codevibes-backend/**` pattern must be listed **after** `*.{ts,tsx}` so ESLint resolves the right config. Without this, backend files get linted with the frontend-only root config.)
- Only staged files are linted → fast. CI enforces the full repo.

### Absolute-path gate (pre-commit + CI)

**Recommendation: `eslint-plugin-import@^2.32.0` with `import/no-absolute-path` (error), plus a grep in the file-size script.** The repo already has the `@/` alias in both `vite.config.ts` and `tsconfig.app.json` — the rule forces relative or `@/` imports and catches `/src/...`, `/Users/...`, and `http(s)://...` imports that would break under a subpath deployment or another machine:

```js
// root eslint.config.js (and backend flat config)
import { noAbsolutePath } from 'eslint-plugin-import' // or flat config plugin entry
rules: {
  'import/no-absolute-path': 'error',
},
```

- Pre-commit: rule runs via lint-staged on staged `*.ts/tsx`; the custom `check-file-size` node script additionally greps **staged non-TS files** for machine-specific absolute paths (`/Users/`, `/home/`, `C:\`) and fails.
- CI: whole repo, in the `quality` job.
- ⚠️ **Known constraint: `eslint-plugin-import` 2.32.0 peers eslint `^2…^9` only — it does not support eslint 10.** Consistent with the "stay on eslint 9" recommendation, but it blocks a future 10.x migration until the plugin releases support (watch for it).

---

## Step 2 — Husky hooks (pre-commit + pre-push wiring)

**Recommendation: husky v9.**

- `npx husky@^9.1.7 init` (creates `.husky/`) and **add `"prepare": "husky"` to root `package.json`** — without it, hooks never activate after `npm install`/`bun install` (husky v9 uses `core.hooksPath`; the `prepare` script is the activation step).
- `pre-commit` hook — **gitleaks runs FIRST, before lint-staged mutates the index** (lint-staged `--fix` re-stages modified files; scanning post-fix content can miss/obscure patterns):
  ```sh
  gitleaks protect --staged
  npx lint-staged
  ```
- `pre-push` hook:
  ```sh
  gitleaks protect
  npm run typecheck
  npx vitest run --changed  # smoke only; full coverage lives in CI
  ```
- **Per-tool flag cheat-sheet (no `--prefix` — that's npm-only):** eslint → `--config <path>`; tsc → `-p <tsconfig>`; vitest → `--config <path>` or `-c`; gitleaks → `--path <dir>`. Run hooks from repo root and reference configs by path.

---

## Step 3 — TypeScript typecheck (pre-push + CI)

**Recommendation: per-package `tsc --noEmit`.**

- Root script: `"typecheck": "tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p codevibes-backend/tsconfig.json"`.
- Backend `tsconfig.json` sets `declaration: true`, `declarationMap: true`, `sourceMap: true`, `outDir: ./dist`. `--noEmit` overrides these and is required — **never drop `--noEmit`** here, or tsc will emit declarations/source maps into `dist/` and pollute the tree.
- Cheap and catches real bugs — land it early (Step 2 in execution order).

---

## Step 4 — Secret detection: gitleaks (pre-commit + pre-push + CI)

**Recommendation: gitleaks.**

- Install: `brew install gitleaks` (v8.30.1; devs). CI: download the **pinned binary** for v8.30.1 from GitHub releases (`gitleaks_8.30.1_<os>_<arch>.tar.gz`), not `latest` — pin exact versions in CI.
- Add `.gitleaks.toml` baseline for test fixtures.
- **`protect` vs `detect` — they are NOT equivalent gates:** `gitleaks protect` scans working-tree changes (local-only; misses secrets already committed); `gitleaks detect` scans repo history (the real safety net, CI-only). Hooks use `protect`; CI must run `detect`.

---

## Step 5 — Vitest + coverage thresholds (pre-push + CI)

**Recommendation: Vitest 4 for the frontend (Vite-native, jsdom + @testing-library/react). For the backend, Vitest with `node` environment is fine but so is `node:test` — don't assume Vitest is "fastest" there; the real backend complication is `better-sqlite3`.**

- **Prereq: upgrade Vite 5 → 6.** Vitest 4.1.11's peer range is `vite ^6||^7||^8`; the repo has `^5.4.19`. Upgrade Vite to `^6` (and check plugin compatibility: `@vitejs/plugin-react-swc` current major supports Vite 6/7/8) before installing vitest 4. If the Vite upgrade is not acceptable, fall back to vitest 3.x (Node ^18||^20||>=22) — but 4.x is the maintained current line.
- Install `vitest@^4.1.11` + `@vitest/coverage-v8@4.1.11` (must match vitest's version exactly) + `jsdom@^30.0.1` + `@testing-library/react@^16.3.2` + `@testing-library/jest-dom@^7.0.1` (frontend).

- Frontend: `vitest.config.ts` reusing `vite.config.ts`; `environment: 'jsdom'`.
- Backend: vitest `node` environment. **`better-sqlite3` needs native bindings and a DB file** — tests touching DB logic must use in-memory SQLite (`:memory:`) or fixtures/mocking. Plan test fixtures and a `setup.ts` before writing DB tests; don't hand-wave this.
- Coverage config — **correct key is `coverage.thresholds` (plural)**:
  ```ts
  coverage: {
    provider: 'v8',
    reporter: ['text', 'json-summary'],
    include: ['src/**/*.{ts,tsx}'],
    thresholds: { lines: 0, functions: 0, branches: 0, statements: 0 }, // start at 0!
  }
  ```
- **Threshold strategy: start at 0 (or omit) — there are zero tests today, so any positive threshold fails the first PR.** Ratchet up after a meaningful suite exists; use `thresholds.autoUpdate: true` locally to ratchet automatically, or raise ~5%/sprint manually.
- Pre-push: `vitest run --changed` — **only works with git history; requires `fetch-depth: 0` anywhere shallow clones exist (CI)**. Never use `--changed` in CI; CI runs full suite with coverage.

---

## Step 6 — Static security analysis: semgrep (pre-commit + CI)

**Recommendation: semgrep OSS, run natively. Do NOT use `returntocorp/semgrep-action` or `semgrep/semgrep-action` — both are deprecated; current guidance is native `semgrep ci` / `semgrep scan` (see semgrep.dev/docs).**

- Local: `brew install semgrep` (v1.173.0). Keep local and CI versions aligned.
- **No built-in `--changed-files` flag — pass changed files explicitly:**
  ```sh
  semgrep scan --config p/typescript --config p/javascript \
    $(git diff --cached --name-only -- '*.ts' '*.tsx')
  ```
  (Staged files only; falls back to empty scan when nothing is staged.)
- CI: `semgrep ci` (diff-aware with `SEMGREP_BASELINE_REF` on PRs) or a **pinned `semgrep/semgrep:1.173.0`** Docker image with `p/security-audit` + `p/typescript` + `p/javascript`. Version-pin rules in a checked-in `semgrep.yml` if you want zero external drift. Bump the semgrep pin deliberately (release cadence is ~weekly), not silently via `latest`.
- Block on errors; start findings as warnings to avoid first-week friction.

---

## Step 7 — Complexity + file line count gates (pre-commit + CI)

**Recommendation: ESLint core rules + a tiny custom script.**

- All five rules (`complexity`, `max-lines-per-function`, `max-depth`, `max-nested-callbacks`, `max-lines`) are **ESLint core rules — but none are enabled by `typescript-eslint` recommended configs**, so they must be added manually to the flat config in both packages:
  ```js
  rules: {
    complexity: ['error', 10],
    'max-depth': ['error', 4],
    'max-lines-per-function': ['warn', 80],
    'max-nested-callbacks': ['warn', 3],
    'max-lines': ['off', { max: 300 }],
  },
  overrides: [
    { files: ['**/*.test.{ts,tsx}', '**/*.config.{js,ts}'], rules: { 'max-lines': 'off' } },
  ],
  ```
- Custom script `scripts/check-file-size.sh` (node script preferred): fail on any file > 400 lines (excluding configs/fixtures/tests). Runs on **staged files** in pre-commit, **whole repo** in CI.
- Before enabling: measure the 95th percentile of current file lengths; set initial thresholds there or budget a cleanup commit, or the first run fails on existing code.

---

## Step 8 — CI workflow (GitHub Actions, `ci.yml`)

**Recommendation: GitHub Actions; repo already has `.github/workflows`. One workflow, grouped jobs to keep minutes down.**

Shared setup: `actions/checkout` with **`fetch-depth: 0`** (needed if any job uses git-aware scans), **Node 24** (`actions/setup-node` or `oven-sh/setup-bun` with `bun-version: 1.3.14` — satisfies lint-staged 17's Node >= 22.22.1 and vitest 4), and **dependency caching** — `actions/cache` for `~/.bun/install/cache` (or npm cache) so jobs don't each reinstall from scratch. Also add `.nvmrc` (`24`) to the repo so local dev matches CI.

**Grouped jobs (lighter than 8 separate checks — branch protection requires 4):**

| Job | Contents |
|---|---|
| `quality` | lint (root + backend) + `tsc --noEmit` both packages |
| `test` | `vitest run --coverage` both packages (thresholds enforced; per-file `coverage.include` scoping) |
| `build` | `vite build` + backend `tsc` build |
| `security` | gitleaks `detect` (full history) + semgrep `ci` |

Branch protection: require all 4 jobs to pass on PRs. That's 4 required checks, not 8.

---

## Step 9 — Optional extras (recommended after core gates are green)

| Extra | Tool | Notes |
|---|---|---|
| Formatting | Prettier 3.9.6 | Single source of truth; `--write` in lint-staged, `--check` in CI; one-time format-all commit. |
| Dependency audit | `npm audit` / `bun audit` | CI job, fail on high/critical only. |
| Commit message lint | commitlint + `@commitlint/config-conventional` | Only if you adopt conventional commits. |
| PR size guard | custom action/script | Fail PRs > 30 files / > 1000 lines. |
| Lockfile hygiene | delete `package-lock.json` ×2 if standardizing on bun | See the top-of-plan warning. |
| Branch protection | GitHub settings | Code gates don't block merges unless enabled. |

---

## Execution order (recommended sequencing)

1. **Step 0** — backend ESLint config + devDeps (unblocks lint wiring).
2. **Step 1** — lint-staged + ESLint (pre-commit).
3. **Step 3** — typecheck (trivial, zero infra — land it now, not later).
4. **Step 8 skeleton** — CI `quality` + `build` jobs so CI exists from day one.
5. **Step 2** — husky wiring (pre-commit: gitleaks → lint-staged; pre-push: typecheck + smoke tests) + `prepare` script.
6. **Step 4** — gitleaks (hooks + CI `detect` job).
7. **Step 7** — complexity/line limits (staged → whole repo).
8. **Step 5** — Vitest + coverage (biggest effort: Vite 5→6 upgrade first, no test infra exists; backend needs in-memory SQLite/fixtures).
9. **Step 6** — semgrep.
10. **Step 9** — extras.

## Open decisions to confirm

- [ ] **Package manager: bun (recommended) vs npm — delete the other lockfile(s)**
- [ ] **eslint: stay on 9.x (recommended, zero migration) vs upgrade to 10.8.1**
- [ ] **Vite 5→6 upgrade required for vitest 4 (recommended) vs vitest 3.x fallback**
- [ ] husky vs lefthook as hook runner
- [ ] Backend test framework: Vitest vs `node:test`
- [ ] Coverage ratchet: `autoUpdate` vs manual 5%/sprint (threshold starts at 0 regardless)
- [ ] Complexity limit 10 vs 12 — measure current code first
- [ ] semgrep rules: registry packs vs versioned `semgrep.yml`
- [ ] Adopt Prettier or not