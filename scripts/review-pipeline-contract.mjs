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
const effortConfig = source("codevibes-backend/src/config/effort.ts");
const github = source("codevibes-backend/src/services/githubService.ts");
const deepseek = source("codevibes-backend/src/services/deepseekService.ts");
const tokens = source("codevibes-backend/src/utils/tokenCounter.ts");

const sourceExtensions = requireMatch(
  fileFilter,
  /const SOURCE_EXTENSIONS = new Set\(\[([\s\S]*?)\n\]\);/,
  "recognized source extensions",
);
const extensions = [...sourceExtensions.matchAll(/'([a-z0-9]+)'/gi)].map((match) => match[1]);
const ignoredPatterns = [...requireMatch(
  fileFilter,
  /const IGNORE_PATTERNS = \[([\s\S]*?)\n\];/,
  "ignore patterns",
).matchAll(/'([^']+)'/g)].map((match) => match[1]);
const priority1DirectPatterns = [...requireMatch(
  fileFilter,
  /const PRIORITY_1_DIRECT_PATTERNS = \[([\s\S]*?)\n\];/,
  "priority 1 direct patterns",
).matchAll(/'([^']+)'/g)].map((match) => match[1]);
const dotenvPatterns = priority1DirectPatterns.filter((pattern) => pattern.startsWith(".env"));
const terraformPatterns = priority1DirectPatterns.filter((pattern) => pattern.includes("*.tf"));
const terraformIgnorePatterns = ignoredPatterns.filter((pattern) => pattern.includes(".terraform"));
const events = [...analysis.matchAll(/type:\s*'([a-z]+)'/g)].map((match) => match[1]);

const maxFiles = requireMatch(
  effortConfig,
  /parsePositiveWholeNumber\('MAX_FILES_PER_PRIORITY', env\.MAX_FILES_PER_PRIORITY, (\d+)\)/,
  "MAX_FILES_PER_PRIORITY default",
);
const effortCaps = [...effortConfig.matchAll(/parsePositiveWholeNumber\('EFFORT_([A-Z]+)_MAX_FILES', env\.EFFORT_[A-Z]+_MAX_FILES, (\d+)\)/g)]
  .map((match) => `${match[1].toLowerCase()}=${match[2]}`);
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
| Recognized source extensions | \`${extensions.join(" ")}\` |
| P1 dotenv policy | \`${dotenvPatterns.join(" ")}\`, plus \`.env.<mode>[.<mode>...]\`; modes containing \`example\`, \`template\`, or \`sample\` are not selected |
| Terraform policy | P1: \`${terraformPatterns.join(" ")}\`; ignored: \`${terraformIgnorePatterns.join(" ")}\` |
| Priority order | ignore → P1 → P2 → P3 (first match wins) |

## Discovery and analysis

| Fact | Source value |
|---|---|
| Global files-per-priority safety cap | \`${maxFiles}\` default; overridden by \`MAX_FILES_PER_PRIORITY\` |
| Effort-layer file caps | \`${effortCaps.join(", ")}\` defaults; overridden by each corresponding \`EFFORT_*_MAX_FILES\` setting (each is constrained by the global cap) |
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
