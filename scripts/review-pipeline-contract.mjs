#!/usr/bin/env node
// Generates a small source-owned reference for the review pipeline. It is
// intentionally limited to values and enumerations that prose commonly gets
// wrong; explanatory documentation remains hand-written.
//
// Usage:
//   node scripts/review-pipeline-contract.mjs --write
//   node scripts/review-pipeline-contract.mjs --check
//   node scripts/review-pipeline-contract.mjs          # print to stdout
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(ROOT, "docs", "review-pipeline", "generated-contract.md");

function source(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function requireMatch(text, pattern, label) {
  const match = text.match(pattern);
  if (!match) throw new Error(`Could not extract ${label}; update this generator with the source change.`);
  return match[1];
}

const fileFilter = source("codevibes-backend/src/utils/fileFilter.ts");
const analysis = source("codevibes-backend/src/services/analysisService.ts");
const github = source("codevibes-backend/src/services/githubService.ts");
const deepseek = source("codevibes-backend/src/services/deepseekService.ts");
const tokens = source("codevibes-backend/src/utils/tokenCounter.ts");

const priority3 = requireMatch(
  fileFilter,
  /const PRIORITY_3_PATTERNS = \[([\s\S]*?)\n\];/,
  "Priority 3 patterns",
);
const extensions = [...priority3.matchAll(/'\*\*\/\*\.([a-z0-9]+)'/gi)].map((match) => match[1]);
const events = [...analysis.matchAll(/type:\s*'([a-z]+)'/g)].map((match) => match[1]);

const maxFiles = requireMatch(
  analysis,
  /MAX_FILES_PER_PRIORITY\s*=\s*parseInt\(process\.env\.MAX_FILES_PER_PRIORITY\s*\|\|\s*'([^']+)'/,
  "MAX_FILES_PER_PRIORITY default",
);
const avgTokens = requireMatch(analysis, /AVG_TOKENS_PER_FILE\s*=\s*(\d+)/, "AVG_TOKENS_PER_FILE");
const outputRatio = requireMatch(analysis, /OUTPUT_RATIO\s*=\s*([\d.]+)/, "OUTPUT_RATIO");
const cacheTtlMinutes = requireMatch(github, /CACHE_TTL\s*=\s*(\d+)\s*\*\s*60\s*\*\s*1000/, "cache TTL");
const batchSize = requireMatch(github, /BATCH_SIZE\s*=\s*(\d+)/, "batch size");
const batchDelay = requireMatch(github, /setTimeout\(resolve,\s*(\d+)\)/, "batch delay");
const model = requireMatch(deepseek, /DEEPSEEK_MODEL\s*\|\|\s*'([^']+)'/, "default model");
const temperatures = [...deepseek.matchAll(/temperature:\s*([\d.]+)/g)].map((match) => match[1]);
const maxTokens = [...deepseek.matchAll(/max_tokens:\s*(\d+)/g)].map((match) => match[1]);
const charsPerToken = requireMatch(tokens, /CHARS_PER_TOKEN\s*=\s*(\d+)/, "CHARS_PER_TOKEN");
const inputCost = requireMatch(tokens, /INPUT_COST_PER_MILLION\s*=\s*([\d.]+)/, "input token price");
const outputCost = requireMatch(tokens, /OUTPUT_COST_PER_MILLION\s*=\s*([\d.]+)/, "output token price");

const duplicateFree = (values) => [...new Set(values)];
const content = `# Generated Review-Pipeline Contract

> Generated from application source by \`npm run docs:pipeline-contract\`.
> Do not edit by hand; validate it with \`npm run check:pipeline-contract\`.
> This page covers machine-checkable facts only. The explanatory pages in this
> directory remain the human-maintained specification.

## File selection

| Fact | Source value |
|---|---|
| Recognized P3 source extensions | \`${extensions.join(" ")}\` |
| Priority order | ignore → P1 → P2 → P3 (first match wins) |

## Discovery and analysis

| Fact | Source value |
|---|---|
| Default files per priority | \`${maxFiles}\` (\`MAX_FILES_PER_PRIORITY\`) |
| Tree-cache TTL | \`${cacheTtlMinutes}\` minutes |
| Content-fetch batch size | \`${batchSize}\` |
| Gap between batches | \`${batchDelay}\` ms |
| SSE event types | \`${duplicateFree(events).join(", ")}\` |
| Estimate tokens per file | \`${avgTokens}\` |
| Estimate output ratio | \`${outputRatio}\` |

## Reviewing agent and costs

| Fact | Source value |
|---|---|
| Default model | \`${model}\` |
| Analysis temperature | \`${duplicateFree(temperatures).filter((value) => value !== "").join(", ")}\` |
| Analysis max tokens | \`${duplicateFree(maxTokens).filter((value) => value !== "1").join(", ")}\` |
| Token approximation | \`${charsPerToken}\` characters/token |
| Input price | \`$${inputCost}\` / 1M tokens |
| Output price | \`$${outputCost}\` / 1M tokens |
`;

if (process.argv.includes("--write")) {
  writeFileSync(target, content);
  console.log("✓ wrote docs/review-pipeline/generated-contract.md");
} else if (process.argv.includes("--check")) {
  const existing = readFileSync(target, "utf8");
  if (existing !== content) {
    console.error("✖ docs/review-pipeline/generated-contract.md is stale; run npm run docs:pipeline-contract");
    process.exit(1);
  }
  console.log("✓ review-pipeline generated contract is current");
} else {
  process.stdout.write(content);
}
