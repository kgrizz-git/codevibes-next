# 2. File selection — `codevibes-backend/src/utils/fileFilter.ts`

How CodeVibes decides which files are reviewed, and at what priority.

## Matching engine
- `matchesAnyPattern(filePath, patterns)` (`:227`) uses
  `minimatch(filePath, pattern, { dot: true, matchBase: true })` (`:229`).
  `dot: true` lets `**/.env` match dotfiles; `matchBase: true` lets `*.min.js` match a bare
  basename anywhere.

## Ignore list (always dropped)
`IGNORE_PATTERNS` (`:10`):
- Dependencies: `node_modules`, `vendor`, `__pycache__`, `.venv`, `venv`
- Build output: `dist`, `build`, `out`, `.next`, `.nuxt`, `.output`, `target`
- VCS: `.git`, `.github`, `.gitlab`, `.svn`
- Coverage: `coverage`, `test-results`, `.nyc_output`
- IDE: `.idea`, `.vscode`, `*.swp`, `*.swo`, `.DS_Store`
- Lockfiles: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Gemfile.lock`, `poetry.lock`, `composer.lock`
- Minified: `*.min.js`, `*.min.css`, `*.bundle.js`
- Binary/media: `png jpg jpeg gif ico svg webp mp4 mp3 wav pdf zip tar gz woff woff2 ttf eot`
- Generated: `*.map`, `*.d.ts`, `generated`, `auto-generated`

## Priority tiers (first match wins)
`getFilePriority(filePath)` (`:244`) returns the **first** tier whose patterns match, else `null`
(ignored). Order is P1 → P2 → P3.

### Priority 1 — Security & Secrets (`PRIORITY_1_PATTERNS`, `:86`)
- Env files: `.env`, `.env.local/.production/.development/.test`, `**/.env`
  (`.env.example` is intentionally *not* matched — it carries placeholders).
- Auth/security dirs: `**/auth`, `**/authentication`, `**/authorization`, `**/security`,
  `**/crypto`, `**/secrets`.
- Config: `**/config`, `**/configs`, `**/configuration`, `*.config.js`, `*.config.ts`.
- Keyword filenames: `**/*secret*`, `**/*password*`, `**/*token*`, `**/*key*`,
  `**/*credential*`, `**/*private*`.
- Middleware: `**/middleware`, `**/middlewares`.
- Data layer: `**/database`, `**/db`, `**/repositories`, `**/*.sql`, `**/queries`, `**/migrations`.
- Network security: `**/*cors*`, `**/access-control`.

### Priority 2 — Core Business Logic (`PRIORITY_2_PATTERNS`, `:139`)
- API layer: `**/api`, `**/routes`, `**/router`, `**/endpoints`.
- Business logic: `**/controllers`, `**/services`, `**/handlers`, `**/use-cases`, `**/usecases`.
- Data layer: `**/models`, `**/entities`, `**/schemas`.
- Entry points: `index/main/app/server.{js,ts}`, `main/app/__main__.py`.
- Core source: `src/index.*`, `src/main.*`, `src/app.*`, `lib/**`.

### Priority 3 — Supporting Code (`PRIORITY_3_PATTERNS`, `:179`)
- Utilities: `**/utils`, `**/utilities`, `**/helpers`, `**/common`, `**/shared`, `**/lib`.
- Frontend: `**/components`, `**/views`, `**/pages`, `**/layouts`, `**/templates`.
- Tests: `**/*.test.*`, `**/*.spec.*`, `**/test`, `**/tests`, `**/__tests__`.
- Docs: `*.md`, `**/docs`.
- Styles: `**/*.css`, `**/*.scss`, `**/*.less`.
- **Catch-all source extensions** (this is the language list):
  `js ts jsx tsx py java go rb php rs`.

## Categorization helpers
- `shouldIgnoreFile(filePath)` (`:236`) → matches `IGNORE_PATTERNS`.
- `filterFilesByPriority(files, priority)` (`:272`) → files whose priority equals `priority`.
- `categorizeFiles(files)` (`:282`) → `{ priority1, priority2, priority3, ignored }`.
- `categorizeLazy(files, priorities)` (`:320`) → only builds the requested priority buckets
  (~60% faster; ignores are skipped). Used when only some tiers are needed.
- `getPriorityName(priority)` (`:362`) / `getPriorityDescription(priority)` (`:376`) → UI labels.

## Notes for downstream work (item 5: broader languages & patterns)
- **New language support = extend the P3 catch-all** extension list (`:212-222`). Any file whose
  extension isn't listed there and doesn't match a P1/P2 pattern is **dropped** (`:265-266`).
- **New pattern variation = extend the P1/P2 pattern arrays** (and possibly add ignore patterns).
- `minimatch` with `dot`/`matchBase` already supports glob-heavy rules; prefer globs over
  enumerations where possible.
- The priority model is intentionally conservative (unknown → ignored). Broadening coverage
  should watch the `MAX_FILES_PER_PRIORITY` cap so P3 doesn't starve P1/P2 in the UI flow.
