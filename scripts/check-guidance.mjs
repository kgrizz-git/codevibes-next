#!/usr/bin/env node
// scripts/check-guidance.mjs
//
// Validate repository GUIDANCE consistency. Offline and deterministic — no
// network. Checks:
//   1. Paths referenced by AGENTS.md point to existing files/dirs.
//   2. Required canonical command names exist in root package.json scripts.
//   3. Plan/decision files declare a `status:` metadata line (proposed|active|
//      accepted|deprecated|superseded|archived) so the lifecycle is checkable.
//
// Usage:
//   node scripts/check-guidance.mjs            # report, exit 0
//   node scripts/check-guidance.mjs --strict   # exit 1 on failures
//   node scripts/check-guidance.mjs --json     # JSON report
//   node scripts/check-guidance.mjs --help     # this help
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const REQUIRED_COMMANDS = [
  "lint:frontend",
  "lint:backend",
  "lint:all",
  "test:frontend",
  "test:backend",
  "test:all",
  "test:frontend:coverage",
  "test:backend:coverage",
  "test:all:coverage",
  "build:frontend",
  "build:backend",
  "build:all",
  "check:fast",
  "check:all",
  "ci",
  "repo:map",
  "docs:pipeline-contract",
  "check:pipeline-contract",
  "check:pipeline-docs",
];

const STATUS_RE = /^(?:>\s*)?(?:-\s*)?(?:\*\*)?status:(?:\*\*)?\s*(proposed|active|accepted|deprecated|superseded|archived)\s*$/im;

function readJsonSafe(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

// Bounded recursive search for a bare filename under a root (depth limit).
function findFileDown(root, name, maxDepth) {
  if (maxDepth <= 0 || !existsSync(root)) return null;
  let entries = [];
  try {
    entries = readdirSync(root);
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === "dist" || e === "coverage" || e === ".git") continue;
    const p = join(root, e);
    try {
      if (statSync(p).isDirectory()) {
        const hit = findFileDown(p, name, maxDepth - 1);
        if (hit) return hit;
      } else if (e === name) {
        return p;
      }
    } catch {
      /* ignore unreadable */
    }
  }
  return null;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "coverage") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(md)$/i.test(name)) out.push(p);
  }
  return out;
}

function main() {
  const errors = [];

  // 1. AGENTS.md referenced paths.
  const agentsPath = join(ROOT, "AGENTS.md");
  if (existsSync(agentsPath)) {
    const content = readFileSync(agentsPath, "utf8");
    // Match `path`, code spans `path`, and bare `path/` directory references.
    const pathLike = content.matchAll(/`([A-Za-z0-9_.\/-]+\.[A-Za-z0-9]+|[A-Za-z0-9_.\/-]+\/)`/g);
    // Bare filenames (e.g. `fileFilter.ts`) may be referenced without a dir;
    // resolve them against known source roots before calling them missing.
    const SRC_ROOTS = [join(ROOT, "src"), join(ROOT, "codevibes-backend", "src"), ROOT];
    const resolveRef = (ref) => {
      if (existsSync(join(ROOT, ref))) return join(ROOT, ref);
      // Bare file: search source roots recursively (bounded depth).
      if (!ref.includes("/")) {
        for (const base of SRC_ROOTS) {
          const hit = findFileDown(base, ref, 6);
          if (hit) return hit;
        }
      }
      return null;
    };
    const seen = new Set();
    for (const m of pathLike) {
      let ref = m[1];
      if (ref.endsWith("/")) ref = ref.slice(0, -1);
      // Skip obviously generic tokens.
      if (!/[/]/.test(ref) && !ref.includes(".")) continue;
      if (seen.has(ref)) continue;
      seen.add(ref);
      if (!resolveRef(ref)) {
        errors.push({ check: "agents-paths", ref, error: `referenced path does not exist: ${ref}` });
      }
    }
  } else {
    errors.push({ check: "agents-paths", ref: "AGENTS.md", error: "AGENTS.md missing" });
  }

  // 2. Required commands present in root package.json.
  const rootPkg = readJsonSafe(join(ROOT, "package.json"));
  if (!rootPkg || !rootPkg.scripts) {
    errors.push({ check: "commands", ref: "package.json", error: "root package.json scripts missing" });
  } else {
    for (const cmd of REQUIRED_COMMANDS) {
      if (!(cmd in rootPkg.scripts)) {
        errors.push({ check: "commands", ref: cmd, error: `required command not defined: npm run ${cmd}` });
      }
    }
  }

  // 3. Plan/decision status metadata. Walk each lifecycle root exactly once.
  const seenPlanFiles = new Set();
  const planRoots = [join(ROOT, "plans")];
  if (existsSync(join(ROOT, "plans", "decisions"))) planRoots.push(join(ROOT, "plans", "decisions"));
  if (existsSync(join(ROOT, "plans", "archive"))) planRoots.push(join(ROOT, "plans", "archive"));
  for (const root of planRoots) {
    for (const f of walk(root)) {
      if (seenPlanFiles.has(f)) continue;
      seenPlanFiles.add(f);
      const rel = relative(ROOT, f).split(sep).join("/");
      // A backlog and index are not lifecycle-managed plans or ADRs.
      if (rel === "plans/TO_DO.md" || /\/README\.md$/i.test(rel)) continue;
      // Skip the harness-engineering plan itself if it's the active spec under
      // change; still validate others. Treat any .md under plans as needing a
      // status line, EXCEPT this checker's own guiding plan is exempt only if
      // it's the active one being implemented (kept simple: require status on
      // all to keep the rule uniform and checkable).
      const content = readFileSync(f, "utf8");
      if (!STATUS_RE.test(content)) {
        errors.push({ check: "plan-status", ref: rel, error: `missing or invalid 'status:' metadata (allowed: proposed|active|accepted|deprecated|superseded|archived)` });
      }
    }
  }

  return errors;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`check-guidance.mjs — validate AGENTS.md paths, required commands, plan status

Usage:
  node scripts/check-guidance.mjs            # report, exit 0
  node scripts/check-guidance.mjs --strict   # exit 1 on failures
  node scripts/check-guidance.mjs --json     # JSON report
`);
  process.exit(0);
}

const errors = main();
const asJson = process.argv.includes("--json");
const strict = process.argv.includes("--strict");

if (asJson) {
  console.log(JSON.stringify({ failures: errors.length, errors }, null, 2));
} else {
  if (errors.length === 0) {
    console.log("✓ check-guidance passed (AGENTS paths, required commands, plan statuses all valid)");
  } else {
    console.error(`✖ check-guidance found ${errors.length} issue(s):`);
    for (const e of errors) {
      console.error(`  - [${e.check}] ${e.ref}: ${e.error}`);
    }
  }
}

if (strict && errors.length > 0) process.exit(1);
process.exit(0);
