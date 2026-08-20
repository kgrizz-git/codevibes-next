#!/usr/bin/env node
// Ensures behavioral changes to a review-pipeline source module include the
// matching human-maintained documentation page. It checks merge-base history
// plus staged and unstaged work so it is useful both in CI and locally.
// Usage: node scripts/check-review-pipeline-docs.mjs [--base <git-ref>]
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAPPINGS = {
  "codevibes-backend/src/utils/fileFilter.ts": "docs/review-pipeline/02-file-selection.md",
  "codevibes-backend/src/services/githubService.ts": "docs/review-pipeline/01-discovery.md",
  "codevibes-backend/src/services/analysisService.ts": "docs/review-pipeline/03-orchestration-sse.md",
  "codevibes-backend/src/services/deepseekService.ts": "docs/review-pipeline/04-reviewing-agent.md",
  "codevibes-backend/src/utils/tokenCounter.ts": "docs/review-pipeline/05-cost-model.md",
};

function git(args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function changedFiles(args) {
  const output = git(args);
  return output ? output.split("\n").filter(Boolean) : [];
}

const baseFlag = process.argv.indexOf("--base");
const requestedBase = baseFlag >= 0 ? process.argv[baseFlag + 1] : null;
const candidates = [
  requestedBase,
  process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null,
  "@{upstream}",
  "origin/main",
].filter(Boolean);
let base = null;
for (const candidate of candidates) {
  base = git(["merge-base", "HEAD", candidate]);
  if (base) break;
}

const files = new Set([
  ...(base ? changedFiles(["diff", "--name-only", `${base}...HEAD`]) : []),
  ...changedFiles(["diff", "--name-only"]),
  ...changedFiles(["diff", "--cached", "--name-only"]),
]);

const changedSources = [...files].filter((file) => file in MAPPINGS);
if (changedSources.length === 0) {
  console.log("✓ review-pipeline docs check passed (no mapped source changes)");
  process.exit(0);
}
if (!base) {
  console.error("✖ Could not establish a merge base for review-pipeline documentation check. Pass --base <ref>.");
  process.exit(1);
}

const missing = changedSources.filter((source) => !files.has(MAPPINGS[source]));
if (missing.length > 0) {
  console.error("✖ Review-pipeline source changed without its matching documentation page:");
  for (const source of missing) console.error(`  - ${source} → ${MAPPINGS[source]}`);
  console.error("Update the page (or make a deliberate documentation-only follow-up before merge).");
  process.exit(1);
}

console.log(`✓ review-pipeline docs check passed (${changedSources.length} mapped source change(s) documented)`);
