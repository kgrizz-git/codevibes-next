#!/usr/bin/env node
// Run affected frontend and backend tests from a merge base. When no suitable
// base is available (for example, a first push), run both full suites instead.
import { execFileSync } from "node:child_process";

function tryGit(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

const base = tryGit(["merge-base", "HEAD", "@{upstream}"]);

if (!base) {
  console.log("No comparison base for affected tests — running full suites");
  run("npm", ["run", "test:all"]);
  process.exit(0);
}

console.log(`Running affected tests since ${base}`);
run("npx", ["vitest", "run", "--changed", base]);
run("npm", ["--prefix", "codevibes-backend", "run", "test", "--", "--changed", base]);
