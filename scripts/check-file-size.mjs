#!/usr/bin/env node
// check-file-size.mjs
// Fails if any source/config file exceeds MAX_LINES, and greps staged non-TS files for
// machine-specific absolute paths (macOS/Linux home directories, Windows
// drives) that would break under a subpath deployment or on another machine.
//
// Usage:
//   node scripts/check-file-size.mjs            # whole repo (blocking)
//   node scripts/check-file-size.mjs --staged   # only staged files (pre-commit)
//   node scripts/check-file-size.mjs --advisory # report without blocking
//
// The legacy ceilings in structural-exceptions.json let existing large files
// stay temporarily while preventing them from growing. New files remain
// subject to the normal MAX_LINES limit.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MAX_LINES = 500;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { exceptions = {} } = JSON.parse(
  readFileSync(join(ROOT, "scripts", "structural-exceptions.json"), "utf8"),
);
const EXCLUDE = new Set([
  "node_modules",
  "dist",
  "package-lock.json",
  "bun.lockb",
  ".husky",
  "public",
]);
// Docs under plans/ legitimately discuss machine-specific path patterns
// (e.g. the quality-gates plan describing the absolute-path rule itself), so
// the absolute-path gate is skipped there. The line-count gate still applies.
const ABS_PATH_EXCLUDE = new Set(["plans"]);

function listFiles(staged) {
  if (staged) {
    const out = execFileSync(
      "git",
      ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
      { encoding: "utf8" },
    ).trim();
    return out ? out.split("\n") : [];
  }
  const out = execFileSync("git", ["ls-files"], { encoding: "utf8" }).trim();
  return out ? out.split("\n") : [];
}

function isExcluded(path) {
  // Long-form docs are governed by the link/guidance checks, not a source-code
  // structural limit. This keeps the gate focused on maintainable code.
  if (path.endsWith(".md")) return true;
  return path.split("/").some((seg) => EXCLUDE.has(seg));
}

const staged = process.argv.includes("--staged");
const advisory = process.argv.includes("--advisory");
let failures = 0;

for (const file of listFiles(staged)) {
  if (isExcluded(file) || !existsSync(file)) continue;

  // Line-count gate (all files).
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");
  // A trailing newline produces one empty trailing item; drop it so
  // "a\n" counts as 1 line while "a" (no newline) and "" keep their counts.
  const lineCount = content.endsWith("\n") ? lines.length - 1 : lines.length;
  const exception = exceptions[file];
  const maxLines = exception?.maxLines ?? MAX_LINES;
  if (lineCount > maxLines) {
    const qualifier = exception
      ? `grandfathered ceiling of ${maxLines}`
      : `limit of ${MAX_LINES}`;
    console.error(`✖ ${file}: ${lineCount} lines exceeds ${qualifier}`);
    failures++;
  }

  // Absolute-path gate (all files except ABS_PATH_EXCLUDE dirs). TS/TSX
  // imports are additionally covered by eslint import/no-absolute-path; this
  // scan catches string values.
  // Boundary excludes letters, digits, _, ., /, and - so quoted, assigned,
  // CSS url(), and JSON values match while URLs and plain words do not.
  // Only the first path segment is checked so `src/plans/file.ts` is still
  // scanned while `plans/file.ts` is excluded.
  if (!ABS_PATH_EXCLUDE.has(file.split("/")[0])) {
    // Drive paths match with either separator style (backslash or forward slash).
    const absMatch = content.match(/(^|[^A-Za-z0-9_.\/-])(\/Users\/|\/home\/|[A-Za-z]:[\\/])/);
    if (absMatch) {
      console.error(`✖ ${file}: machine-specific absolute path detected: ${absMatch[2]}`);
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} file-size/absolute-path check(s) failed.`);
  if (!advisory) process.exit(1);
  console.log("(advisory only — these did not block)");
} else {
  console.log("✓ check-file-size passed");
}
