#!/usr/bin/env node
// scripts/check-doc-links.mjs
//
// Validate LOCAL Markdown links and anchors. Offline and deterministic — no
// network access. Checks:
//   1. In-repo relative links resolve to an existing file.
//   2. In-repo #anchor links (same-file or path#anchor) resolve to a heading
//      whose slug matches the anchor (GitHub-style slugging).
//
// Usage:
//   node scripts/check-doc-links.mjs                 # scan README, docs, plans, AGENTS
//   node scripts/check-doc-links.mjs --strict        # exit 1 on any failure
//   node scripts/check-doc-links.mjs --json          # machine-readable report
//   node scripts/check-doc-links.mjs --help          # this help
//
// By default failures are reported but exit code stays 0 so this can run cheaply
// in pre-commit on changed docs; CI passes --strict.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, sep, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// Scan roots for Markdown files (README*, *.md). AGENTS files are .md too.
const SCAN_ROOTS = ["README.md", join(ROOT, "docs"), join(ROOT, "plans"), join(ROOT, "AGENTS.md")];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "coverage") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.md$/i.test(name)) out.push(p);
  }
  return out;
}

function collectMarkdownFiles() {
  const files = [];
  for (const entry of SCAN_ROOTS) {
    const abs = entry.startsWith(ROOT) ? entry : join(ROOT, entry);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isDirectory()) files.push(...walk(abs));
    else if (extname(abs) === ".md") files.push(abs);
  }
  return files;
}

// GitHub heading slug rules (simplified, good enough for our docs):
// lowercase, strip non-word/space/ hyphen chars, spaces -> hyphens.
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

function extractHeadings(content, sourcePath) {
  const slugs = new Set();
  const lines = content.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    // ATX heading
    const m = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (m) {
      slugs.add(slugify(m[1]));
      continue;
    }
    // Setext heading: underline of = or - on next line (not within list/blockquote)
    if (i + 1 < lines.length && /^\s*[-=]{2,}\s*$/.test(lines[i + 1]) && line.trim() !== "") {
      slugs.add(slugify(line));
    }
  }
  return slugs;
}

// Link regex: [text](target) — capture target. Avoid matching images ![..](..).
const LINK_RE = /(?<!\!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function normalizeLink(target, baseDir) {
  // Resolve relative to the SOURCE FILE's directory for in-repo links (strip
  // anchor). Root-absolute links ("/foo") resolve against ROOT.
  const [pathPart, hash] = target.split("#");
  let absPath;
  if (pathPart.startsWith("/")) {
    absPath = join(ROOT, pathPart);
  } else if (pathPart === "" || pathPart === undefined) {
    // Same-file anchor only.
    absPath = null;
  } else {
    absPath = join(baseDir, pathPart);
  }
  return { pathPart, hash: hash ?? "", absPath, isExternal: /^https?:\/\//i.test(target) || /^mailto:/i.test(target) };
}

function main() {
  const errors = [];
  const files = collectMarkdownFiles();
  const headingCache = new Map();

  for (const file of files) {
    const rel = relative(ROOT, file).split(sep).join("/");
    let content;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      errors.push({ file: rel, link: "", error: "cannot read file" });
      continue;
    }
    const baseDir = dirname(file);
    let match;
    LINK_RE.lastIndex = 0;
    while ((match = LINK_RE.exec(content)) !== null) {
      const target = match[1];
      if (!target || target.startsWith("#") || target.startsWith("/")) {
        // same-file anchor or root-absolute; resolve against file for anchors
      }
      const { pathPart, hash, absPath, isExternal } = normalizeLink(target, baseDir);
      if (isExternal) continue;

      if (hash) {
        // Must point to a heading in the target file (same file if path empty).
        const targetFile = absPath ?? file;
        if (!existsSync(targetFile)) {
          errors.push({ file: rel, link: target, error: `link target file not found: ${pathPart || "(self)"}` });
          continue;
        }
        if (!headingCache.has(targetFile)) {
          headingCache.set(targetFile, extractHeadings(readFileSync(targetFile, "utf8"), targetFile));
        }
        const slugs = headingCache.get(targetFile);
        if (!slugs.has(hash)) {
          errors.push({
            file: rel,
            link: target,
            error: `anchor #${hash} not found in ${relative(ROOT, targetFile).split(sep).join("/")}`,
          });
        }
      } else if (pathPart && pathPart !== "") {
        if (!existsSync(absPath)) {
          errors.push({ file: rel, link: target, error: `file not found: ${pathPart}` });
        }
      }
    }
  }

  return errors;
}

const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`check-doc-links.mjs — validate local Markdown links/anchors (offline)

Usage:
  node scripts/check-doc-links.mjs            # report, exit 0
  node scripts/check-doc-links.mjs --strict   # exit 1 on failures
  node scripts/check-doc-links.mjs --json     # JSON report
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
    console.log("✓ check-doc-links passed (all local links/anchors resolve)");
  } else {
    console.error(`✖ check-doc-links found ${errors.length} issue(s):`);
    for (const e of errors) {
      console.error(`  - ${e.file}: [${e.link || "(self)"}] ${e.error}`);
    }
  }
}

if (strict && errors.length > 0) process.exit(1);
process.exit(0);
