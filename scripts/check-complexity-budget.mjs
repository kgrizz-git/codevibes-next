#!/usr/bin/env node
// Enforces a shrink-only baseline for structural ESLint diagnostics. ESLint
// keeps these rules as warnings so direct `npm run lint` remains informative;
// this command turns any new or worsened structural diagnostic into a failure.
// Usage: node scripts/check-complexity-budget.mjs [--print-baseline]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STRUCTURAL_RULES = new Set([
  "complexity",
  "max-depth",
  "max-lines",
  "max-lines-per-function",
  "max-nested-callbacks",
]);

function runEslint(cwd, executable) {
  try {
    return execFileSync(executable, ["--format", "json", "."], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (typeof error.stdout === "string") return error.stdout;
    throw error;
  }
}

function diagnostic(packageRoot, result, message) {
  const relativeFile = result.filePath.startsWith(packageRoot)
    ? result.filePath.slice(packageRoot.length + 1)
    : result.filePath;
  const file = packageRoot === ROOT ? relativeFile : `codevibes-backend/${relativeFile}`;
  // Locations change during ordinary edits. The measured value is recorded as
  // a ceiling separately, letting a legacy violation improve without requiring
  // a baseline edit while still rejecting any increase.
  const measured = message.message.match(
    /(?:complexity of (\d+)|too many lines \((\d+)\)|nested too deeply \((\d+)\))\./,
  );
  if (!measured) {
    throw new Error(`Cannot determine structural metric: ${message.message}`);
  }
  const value = Number(measured[1] ?? measured[2] ?? measured[3]);
  const normalizedMessage = message.message.replace(/(complexity of |too many lines \(|nested too deeply \()\d+/, "$1#");
  return {
    key: `${file}\t${message.ruleId}\t${normalizedMessage}`,
    value,
    display: `${file}\t${message.ruleId}\t${message.message}`,
  };
}

function collect(packageRoot, executable) {
  const output = runEslint(packageRoot, executable);
  return JSON.parse(output).flatMap((result) =>
    result.messages
      .filter((message) => STRUCTURAL_RULES.has(message.ruleId))
      .map((message) => diagnostic(packageRoot, result, message)),
  );
}

const rootEslint = join(ROOT, "node_modules", ".bin", "eslint");
const backendRoot = join(ROOT, "codevibes-backend");
const backendEslint = join(backendRoot, "node_modules", ".bin", "eslint");
if (!existsSync(rootEslint) || !existsSync(backendEslint)) {
  console.error("✖ ESLint executables are missing; run npm ci in both packages first.");
  process.exit(1);
}

const observed = [
  ...collect(ROOT, rootEslint),
  ...collect(backendRoot, backendEslint),
].sort((a, b) => a.key.localeCompare(b.key) || a.value - b.value);

if (process.argv.includes("--print-baseline")) {
  console.log(
    JSON.stringify(
      { version: 1, diagnostics: observed.map(({ display }) => display) },
      null,
      2,
    ),
  );
  process.exit(0);
}

const baselinePath = join(ROOT, "scripts", "complexity-baseline.json");
const baseline = JSON.parse(readFileSync(baselinePath, "utf8")).diagnostics;
const ceilingsByKey = new Map();
for (const item of baseline) {
  const [file, ruleId, message] = item.split("\t");
  const measured = message.match(
    /(?:complexity of (\d+)|too many lines \((\d+)\)|nested too deeply \((\d+)\))\./,
  );
  const value = Number(measured?.[1] ?? measured?.[2] ?? measured?.[3]);
  const key = `${file}\t${ruleId}\t${message.replace(/(complexity of |too many lines \(|nested too deeply \()\d+/, "$1#")}`;
  const values = ceilingsByKey.get(key) ?? [];
  values.push(value);
  ceilingsByKey.set(key, values);
}
for (const values of ceilingsByKey.values()) values.sort((a, b) => a - b);

const observedByKey = new Map();
for (const item of observed) {
  const values = observedByKey.get(item.key) ?? [];
  values.push(item);
  observedByKey.set(item.key, values);
}

const regressions = [];
for (const [key, items] of observedByKey) {
  const ceilings = ceilingsByKey.get(key) ?? [];
  const sorted = [...items].sort((a, b) => a.value - b.value);
  for (const [index, item] of sorted.entries()) {
    if (item.value > (ceilings[index] ?? -Infinity)) regressions.push(item);
  }
}

if (regressions.length > 0) {
  console.error("✖ New or worsened structural ESLint diagnostic(s):");
  for (const item of regressions) console.error(`  ${item.display.replaceAll("\t", ": ")}`);
  console.error("Refactor the code, or deliberately update the shrink-only baseline with review.");
  process.exit(1);
}

const remaining = baseline.length - observed.length;
console.log(
  `✓ complexity budget passed (${observed.length} legacy diagnostic(s) within ceiling; ${remaining} baseline diagnostic(s) removed)`,
);
