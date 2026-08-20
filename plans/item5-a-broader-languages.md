# Plan A (Item 5) — Broader Language and Pattern Coverage

> status: accepted
> **Review state:** implementation plan.
> **Primary code:** `codevibes-backend/src/utils/fileFilter.ts` and its tests.
> **Risk:** Medium, not low: prioritization decides which files consume a fixed per-tier cap.

## Verified baseline

- The P3 extension catch-all is the admission gate for ordinary source files. It currently has
  `js ts jsx tsx py java go rb php rs`; **Swift is not in it**. An unrecognized file can still be
  promoted by a P1/P2 name or directory pattern, because those tiers are checked before P3.
- Matching uses `minimatch({ dot: true, matchBase: true })`; it is case-sensitive and a basename
  pattern can match anywhere. First tier wins: ignore → P1 → P2 → P3 → `null`.
- `.env.example` is currently neither ignored nor selected. Preserve that outcome (`null`), rather
  than moving it to `ignored`, unless the product deliberately changes the displayed ignored count.
- `getCategorizedFileCounts` already computes an ignored count, but the estimate response drops
  it. The UI currently creates placeholder file names from counts; it has no classifier reason or
  actual pre-analysis file list.

## Design rules

1. Keep a single explicit, lowercase source-extension allowlist and test it. Add the following
   initial set after checking the repository corpus: `kt kts cs c h cc cpp cxx hpp m mm swift
   scala sc ex exs dart lua r pl pm sh bash zsh ps1 fs fsx vb groovy clj cljs hs erl hrl zig sol`.
   Retain all existing extensions. Add Terraform's `.tf`, `.tfvars`, `.tf.json`, and `.tfvars.json`
   forms through the Terraform rule below rather than silently treating them as generic supporting
   code.
2. First-class convention coverage is narrow and language-specific:
   - Go: `cmd/`, `internal/`, `pkg/`, and `handlers/` source files are P2; exact `main.go` is P2.
   - Rust: `crates/*/src/`, `src/main.rs`, `src/lib.rs`, `src/bin/`, and `Cargo.toml` are P2.
     Do not promote every repository's `src/**` directory.
   - TypeScript: preserve existing explicit entry points and add exact recognized-extension
     entry-point forms only where tests prove a gap. Do not add `packages/**` or `apps/**` as
     generic business logic.
3. Add only reviewed framework patterns: P1 `oauth`, `jwt`, `session`, `iam`, and `vault`; P2
   `graphql`, `resolvers`, `mutations`, `workers`, `jobs`, and `tasks`. `queries` stays P1.
   `.envrc` is P1. Dotenv mode files are P1 only when the matcher explicitly excludes every
   `example`, `template`, and `sample` mode segment.
4. Terraform is P1 (`**/*.tf`, `**/*.tfvars`, `**/*.tf.json`, `**/*.tfvars.json`) and `.terraform/**` is ignored. This recognizes
   infrastructure policy and potential secret-bearing vars while excluding provider cache data.
5. Never add broad, unqualified filename signals. If a filename convention is needed, bind it to
   the recognized extension set (or use exact names). Add a regression test showing a non-source
   file matching the textual signal is not promoted.

## Implementation steps

1. Refactor the classifier only enough to make extension-gated P1/P2 filename conventions clear
   and reusable. Preserve explicitly supported non-source inputs such as `.env`, `Cargo.toml`, and
   Terraform. Avoid duplicating an extension list in each glob.
2. Add the admission extensions and the narrow P1/P2 patterns above. Keep ignored paths checked
   first, including `.terraform/**` before Terraform's P1 rules.
3. Export a small, read-only classifier metadata/decision API only if Plan B's scope UI is accepted
   (for example: supported extensions and a stable rule identifier, not raw internal arrays).
   `getFilePriority` alone cannot explain the winning rule. Do not add a client-side copy of rules.
4. Do not implement the scope UI in this plan. A per-file decision/ignored-path API changes GitHub
   tree handling, private-repository authorization, response size, and frontend state; it belongs
   to Plan B's explicitly bounded optional slice.

## Required tests

Extend `fileFilter.test.ts` with table-driven cases and preserve existing contracts:

- Every new generic source extension has one P3 example (`.dart`, `.cs`, `.swift`, C/C++ headers,
  shell, etc.); Terraform is excluded because `.tf`, `.tfvars`, `.tf.json`, and `.tfvars.json`
  are P1 policy inputs.
- `.envrc`, OAuth/JWT paths, and Terraform `.tf`, `.tfvars`, `.tf.json`, and `.tfvars.json` are P1;
  `.terraform/...` is `null`.
- `.env.example`, `.env.template`, and `.env.sample` remain `null`, not P1 or ignored.
- `graphql/resolvers` and each Go/Rust convention land in the intended P2 tier; `queries` remains
  P1. Include root and nested `main.go`, `src/main.rs`, and `src/lib.rs` cases.
- An ad-hoc layout such as `src/backend/foo.py` remains reviewable at P3 unless it matches a
  deliberate convention; it must not be falsely promoted just because it sits under `src`.
- A Markdown, binary, or unknown extension whose basename contains `main`, `model`, `route`, or
  `test` is not promoted. This guards `matchBase` false positives.
- Ignore-first and first-tier-wins regressions, including generated/binary files under a matching
  security directory.
- A `githubService`/analysis-service test confirms each priority is capped independently after
  the larger set is classified; Plan A must not assume a broader P3 affects P1 or P2 ordering.

## Documentation and verification

Update `02-file-selection.md` and `06-extension-hooks.md`, regenerate the contract, and update
the contract generator if the source representation changes. Run:

```sh
npm run test:backend
npm run typecheck
npm run check:pipeline-contract
npm run check:pipeline-docs
npm run check:structure
```

## Out of scope

Per-repository configurable globs, non-English semantic directory inference, shebang/extensionless
scripts, and a full review-scope UI are separate work. The extension admission set ensures those
unusual layouts are reviewed as P3 rather than silently dropped where their extension is known.
