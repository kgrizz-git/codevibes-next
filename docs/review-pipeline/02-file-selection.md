# 2. File selection — `codevibes-backend/src/utils/fileFilter.ts`

How CodeVibes decides which files are reviewed, and at what priority.

## Matching engine
- `matchesAnyPattern` uses `minimatch(filePath, pattern, { dot: true, matchBase: true })`.
  `dot: true` includes dotfiles and `matchBase: true` lets a filename glob match at any depth.
- Because `matchBase` makes broad naming rules surprisingly powerful, P1/P2 directory and filename
  conventions are evaluated only for an explicit recognized-source extension. Exact policy files
  are the exception.

## Ignore list (always dropped)
`IGNORE_PATTERNS` (`:10`):
- Dependencies: `node_modules`, `vendor`, `__pycache__`, `.venv`, `venv`
- Build output: `dist`, `build`, `out`, `.next`, `.nuxt`, `.output`, `target`, `.terraform`
- VCS: `.git`, `.github`, `.gitlab`, `.svn`
- Coverage: `coverage`, `test-results`, `.nyc_output`
- IDE: `.idea`, `.vscode`, `*.swp`, `*.swo`, `.DS_Store`
- Lockfiles: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Gemfile.lock`, `poetry.lock`, `composer.lock`
- Minified: `*.min.js`, `*.min.css`, `*.bundle.js`
- Binary/media: `png jpg jpeg gif ico svg webp mp4 mp3 wav pdf zip tar gz woff woff2 ttf eot`
- Generated: `*.map`, `*.d.ts`, `generated`, `auto-generated`

## Priority tiers (first match wins)
`getFilePriority(filePath)` returns the **first** tier whose patterns match, else `null`.
Order is **ignore → P1 → P2 → P3**.

### Priority 1 — Security & Secrets
- Exact policy inputs: `.env`, `.env.local/.production/.development/.test`, `.envrc`, `*.tf`,
  `*.tfvars`, and `*.sql`. `.env.example`, `.env.template`, and `.env.sample` are not selected.
- Source-gated security/config directories: auth, authentication, authorization, security, crypto,
  secrets, config/configs/configuration, middleware, database/db/repositories/queries/migrations,
  access-control, oauth, jwt, session, iam, and vault.
- Source-gated filenames: `*.config.js`, `*.config.ts`, and names containing secret, password,
  token, key, credential, private, cors, oauth, jwt, session, iam, or vault.

### Priority 2 — Core Business Logic
- Exact manifest: `Cargo.toml`.
- Source-gated directories: API/routes/router/endpoints, controllers/services/handlers/use-cases,
  graphql/resolvers/mutations/workers/jobs/tasks, models/entities/schemas, Go `cmd`/`internal`/`pkg`,
  Rust `crates/*/src` and `src/bin`, and `lib`.
- Source-gated entry points: `index/main/app/server.{js,ts}`, `main/app/__main__.py`, `main.go`,
  Rust `src/main.rs`/`src/lib.rs`, and `src/index.*`/`src/main.*`/`src/app.*`.
- A generic `src/**` path is intentionally not P2: it falls through to P3 unless a narrow rule
  above applies.

### Priority 3 — Supporting Code
- Utilities: `**/utils`, `**/utilities`, `**/helpers`, `**/common`, `**/shared`, `**/lib`.
- Frontend: `**/components`, `**/views`, `**/pages`, `**/layouts`, `**/templates`.
- Tests: `**/*.test.*`, `**/*.spec.*`, `**/test`, `**/tests`, `**/__tests__`.
- Docs: `*.md`, `**/docs`.
- Styles: `**/*.css`, `**/*.scss`, `**/*.less`.
- Any recognized source extension that did not match P1/P2. The source-owned generated contract
  lists the exact set; it includes JavaScript/TypeScript, Python, Java, Go, Ruby, PHP, Rust,
  Kotlin, C/C++/Objective-C, Swift, Scala, Elixir, Dart, Lua, R/Perl, shell/PowerShell, F#/VB,
  Groovy/Clojure/Haskell/Erlang, Zig, and Solidity.

## Categorization helpers
- `shouldIgnoreFile(filePath)` → matches `IGNORE_PATTERNS`.
- `filterFilesByPriority(files, priority)` → files whose priority equals `priority`.
- `categorizeFiles(files)` → `{ priority1, priority2, priority3, ignored }`.
- `categorizeLazy(files, priorities)` → only builds the requested priority buckets
  (~60% faster; ignores are skipped). Used when only some tiers are needed.
- `getPriorityName(priority)` / `getPriorityDescription(priority)` → UI labels.

## Notes for downstream work (item 5: broader languages & patterns)
- **New language support = extend `SOURCE_EXTENSIONS`**. Unknown extensions are dropped unless a
  deliberate non-source P1/P2/P3 rule selects them.
- **New pattern variation = extend the direct or source-gated P1/P2 arrays** (and possibly ignore
  patterns). Do not add broad un-gated filename globs such as `*main*` or `*model*`.
- The priority model is intentionally conservative (unknown → ignored). Broadening coverage
  should watch the `MAX_FILES_PER_PRIORITY` cap so P3 doesn't starve P1/P2 in the UI flow.
