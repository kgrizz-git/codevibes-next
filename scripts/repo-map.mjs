#!/usr/bin/env node
// scripts/repo-map.mjs
//
// Print a compact, deterministic, OFFLINE repository map: package entrypoints,
// routes, services, tests, important docs, and ignored/generated paths. This is
// intentionally shallow (directory/boundary level) so it never becomes a stale
// committed artifact — run it on demand.
//
// Usage:
//   node scripts/repo-map.mjs            # human-readable text
//   node scripts/repo-map.mjs --json    # machine-readable JSON for tools
//   node scripts/repo-map.mjs --help     # this help
//
// Exit codes: 0 always (advisory navigation aid). Errors are reported inline.
import { readdirSync, existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function listDir(dir, predicate) {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .map((name) => ({ name, path: join(dir, name) }))
      .filter((entry) => {
        try {
          return predicate(entry);
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function isDir(entry) {
  return statSync(entry.path).isDirectory();
}

function dirNames(dir) {
  return listDir(dir, isDir).map((e) => e.name);
}

function fileNames(dir) {
  return listDir(dir, (e) => !statSync(e.path).isDirectory()).map((e) => e.name);
}

function nonTestFileNames(dir) {
  return fileNames(dir).filter((name) => !/\.(test|spec)\.(ts|tsx|js)$/i.test(name));
}

function topLevel(exclude = []) {
  return listDir(ROOT, (e) => !exclude.includes(e.name)).map((e) =>
    isDir(e) ? e.name + "/" : e.name,
  );
}

function packageNames(dir) {
  return dirNames(dir).sort();
}

function routeFiles(dir) {
  return fileNames(dir)
    .filter((f) => /routes?\.(ts|tsx|js)$/i.test(f))
    .sort();
}

function serviceFiles(dir) {
  return fileNames(dir)
    .filter((f) => /(service|Service)\.(ts|tsx|js)$/i.test(f))
    .sort();
}

function testFiles(dir) {
  const out = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of listDir(d, () => true)) {
      if (e.name === "node_modules" || e.name === "dist" || e.name === "coverage")
        continue;
      if (isDir(e)) walk(e.path);
      else if (/\.(test|spec)\.(ts|tsx|js)$/i.test(e.name))
        out.push(relative(ROOT, e.path).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

function buildMap() {
  const backend = join(ROOT, "codevibes-backend");
  const docs = join(ROOT, "docs");
  const plans = join(ROOT, "plans");

  return {
    root: {
      "package.json": "vite_react_shadcn_ts (frontend, private)",
      name: "codevibes-next (monorepo-ish: two independent npm packages)",
      entries: topLevel([
        "node_modules",
        "dist",
        "coverage",
        ".git",
        ".husky",
        ".github",
        "plans",
        "docs",
        "codevibes-backend",
        "public",
        "tmp",
        "upstream-sync",
      ]),
    },
    frontend: {
      package: "package.json (root)",
      entry: "src/main.tsx",
      app: "src/App.tsx",
      build: "vite build",
      dirs: packageNames(join(ROOT, "src")),
      routes: "(SPA — react-router-dom; see src/pages, src/App.tsx)",
    },
    backend: {
      package: "codevibes-backend/package.json",
      entry: "codevibes-backend/src/server.ts",
      build: "tsc (emits codevibes-backend/dist)",
      dirs: packageNames(backend).filter((d) => d !== "node_modules" && d !== "dist"),
      routes: routeFiles(join(backend, "src", "routes")),
      services: serviceFiles(join(backend, "src", "services")),
      controllers: nonTestFileNames(join(backend, "src", "controllers")).sort(),
      middleware: nonTestFileNames(join(backend, "src", "middleware")).sort(),
    },
    tests: {
      frontend: testFiles(join(ROOT, "src")),
      backend: testFiles(join(backend, "src")),
    },
    docs: {
      reviewPipeline: existsSync(docs)
        ? fileNames(docs).sort()
        : [],
      reviewPipelinePages: existsSync(join(docs, "review-pipeline"))
        ? fileNames(join(docs, "review-pipeline")).sort()
        : [],
    },
    plans: existsSync(plans) ? fileNames(plans).sort() : [],
    ignoredOrGenerated: [
      "node_modules/",
      "dist/ (frontend build)",
      "codevibes-backend/dist/ (backend build)",
      "coverage/",
      "tmp/",
      ".git/",
      "public/ (static assets, not source)",
    ],
    commands: {
      "lint:frontend / lint:backend / lint:all": "eslint the named boundary or both",
      "test:frontend / test:backend / test:all": "run the named suite or both",
      "build:frontend / build:backend / build:all": "produce both distributables explicitly",
      "check:fast": "lint + typecheck + affected tests; no build or network",
      "check:all": "lint + typecheck + full tests + builds + doc/guidance checks",
      ci: "alias of check:all",
      "repo:map": "print this map",
    },
  };
}

function printText(map) {
  const lines = [];
  const section = (t) => lines.push(`\n## ${t}`);
  const kv = (k, v) => lines.push(`  ${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
  const list = (arr) => arr.forEach((x) => lines.push(`  - ${x}`));

  lines.push("# CodeVibes repository map");
  lines.push(`(generated on demand — run \`npm run repo:map\` or \`node scripts/repo-map.mjs --json\`)`);
  section("Root");
  kv("packages", "frontend (root) + codevibes-backend (independent package)");
  kv("entries", map.root.entries);
  section("Frontend (root package)");
  kv("entry", map.frontend.entry);
  kv("dirs", map.frontend.dirs);
  section("Backend (codevibes-backend/)");
  kv("entry", map.backend.entry);
  kv("dirs", map.backend.dirs);
  kv("routes", map.backend.routes);
  kv("services", map.backend.services);
  kv("controllers", map.backend.controllers);
  kv("middleware", map.backend.middleware);
  section("Tests");
  kv("frontend", map.tests.frontend);
  kv("backend", map.tests.backend);
  section("Docs");
  kv("reviewPipeline", map.docs.reviewPipeline);
  kv("reviewPipelinePages", map.docs.reviewPipelinePages);
  section("Plans");
  kv("files", map.plans);
  section("Ignored / generated");
  list(map.ignoredOrGenerated);
  section("Canonical commands");
  Object.entries(map.commands).forEach(([k, v]) => kv(k, v));

  console.log(lines.join("\n"));
}

const arg = process.argv[2];
if (arg === "--help" || arg === "-h") {
  console.log(`repo-map.mjs — offline, deterministic repository map

Usage:
  node scripts/repo-map.mjs            # human-readable text
  node scripts/repo-map.mjs --json    # machine-readable JSON
  node scripts/repo-map.mjs --help    # this help
`);
  process.exit(0);
}

if (arg === "--json") {
  console.log(JSON.stringify(buildMap(), null, 2));
} else {
  printText(buildMap());
}
