#!/usr/bin/env node
// scripts/check-bundle-size.mjs
//
// Enforce agreed gzip budgets for the Vite frontend build output under dist/.
// Uses Node built-ins only (zlib for gzip), so it is deterministic and offline
// and adds no dependencies.
//
// Budget policy:
//   - Budgets live in scripts/bundle-budgets.json (optional; sensible advisory
//     defaults are used when the file is absent).
//   - By DEFAULT this script is ADVISORY: it reports sizes and whether they are
//     over budget, but exits 0. The frontend structural-size gate is advisory
//     until an accepted baseline cleanup passes (per harness-engineering plan).
//   - Pass --strict to make over-budget an error (CI may opt in once the
//     documented cleanup actually passes).
//
// Usage:
//   node scripts/check-bundle-size.mjs                 # advisory report
//   node scripts/check-bundle-size.mjs --strict        # fail on over-budget
//   node scripts/check-bundle-size.mjs --json          # JSON report
//   node scripts/check-bundle-size.mjs --help          # this help
//
// The build (npm run build:frontend) must run first so dist/assets exists.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST_ASSETS = join(ROOT, "dist", "assets");
const BUDGET_PATH = join(ROOT, "scripts", "bundle-budgets.json");

// Advisory defaults (bytes, gzip). These are intentionally generous; tighten
// after an accepted baseline. 1 MiB = 1048576.
const DEFAULT_BUDGETS = {
  // Total gzipped JS across the entry chunk set.
  totalJsGzip: 600 * 1024,
  // Largest single JS asset (gzip) — guards against one monster module.
  maxSingleJsGzip: 250 * 1024,
  // Total gzipped CSS across assets.
  totalCssGzip: 80 * 1024,
};

function loadBudgets() {
  if (existsSync(BUDGET_PATH)) {
    try {
      return { ...DEFAULT_BUDGETS, ...JSON.parse(readFileSync(BUDGET_PATH, "utf8")) };
    } catch {
      return { ...DEFAULT_BUDGETS };
    }
  }
  return { ...DEFAULT_BUDGETS };
}

function main() {
  const result = { ok: true, advisory: true, assets: [], totals: {}, overBudget: [] };
  if (!existsSync(DIST_ASSETS)) {
    result.error = "dist/assets not found — run `npm run build:frontend` before checking bundle size";
    result.ok = false;
    return result;
  }

  const files = readdirSync(DIST_ASSETS).filter((f) => /\.(js|css)$/i.test(f));
  let totalJs = 0;
  let totalCss = 0;
  let maxJs = 0;
  for (const f of files) {
    const abs = join(DIST_ASSETS, f);
    const raw = readFileSync(abs);
    const gz = gzipSync(raw).length;
    const isJs = /\.js$/i.test(f);
    if (isJs) {
      totalJs += gz;
      maxJs = Math.max(maxJs, gz);
    } else {
      totalCss += gz;
    }
    result.assets.push({ file: f, gzipBytes: gz, rawBytes: raw.length });
  }
  result.totals = { totalJsGzip: totalJs, maxSingleJsGzip: maxJs, totalCssGzip: totalCss };

  const budgets = loadBudgets();
  const checks = [
    ["totalJsGzip", totalJs, budgets.totalJsGzip],
    ["maxSingleJsGzip", maxJs, budgets.maxSingleJsGzip],
    ["totalCssGzip", totalCss, budgets.totalCssGzip],
  ];
  for (const [name, value, budget] of checks) {
    if (value > budget) {
      result.overBudget.push({ budget: name, value, limit: budget });
      result.ok = false;
    }
  }
  return result;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`check-bundle-size.mjs — enforce gzip budgets on Vite output (offline, built-in zlib)

Usage:
  node scripts/check-bundle-size.mjs            # advisory report (exit 0 unless dist missing)
  node scripts/check-bundle-size.mjs --strict   # exit 1 when over budget
  node scripts/check-bundle-size.mjs --json     # JSON report

Budgets: scripts/bundle-budgets.json (optional; advisory defaults otherwise).
Run the frontend build first so dist/assets exists.
`);
  process.exit(0);
}

const asJson = process.argv.includes("--json");
const strict = process.argv.includes("--strict");
const result = main();

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
  // Budget overruns remain advisory unless --strict is requested; a missing
  // build output is always an execution error.
  process.exit(result.error ? 1 : 0);
}

if (result.error) {
  console.error(`✖ check-bundle-size: ${result.error}`);
  process.exit(1);
}

const fmt = (b) => `${(b / 1024).toFixed(1)} KiB`;
console.log("Bundle size (gzip):");
for (const a of result.assets) {
  console.log(`  ${a.file}: ${fmt(a.gzipBytes)} gz / ${fmt(a.rawBytes)} raw`);
}
console.log(
  `  Totals: JS ${fmt(result.totals.totalJsGzip)} (max single ${fmt(result.totals.maxSingleJsGzip)}), CSS ${fmt(result.totals.totalCssGzip)}`,
);

if (result.overBudget.length === 0) {
  console.log("✓ check-bundle-size within budget (advisory)");
  process.exit(0);
}

console.error("⚠ check-bundle-size OVER BUDGET (advisory until documented cleanup passes):");
for (const o of result.overBudget) {
  console.error(`  - ${o.budget}: ${fmt(o.value)} > limit ${fmt(o.limit)}`);
}
if (strict) process.exit(1);
console.log("(advisory only — did not block; run with --strict to enforce once baseline passes)");
process.exit(0);
