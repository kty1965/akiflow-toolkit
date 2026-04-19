#!/usr/bin/env bun

// ---------------------------------------------------------------------------
// One-shot import rewriter: converts deep relative imports under src/ to
// the root-based aliases declared in tsconfig.json (@core/@adapters/@mcp/@cli
// and the @config/@composition file aliases).
//
// Rules:
//   - Only relative imports (./, ../) are considered.
//   - Targets that resolve *outside* src/ are left as-is.
//   - Intra-layer imports (same top-level directory under src/) stay relative
//     to preserve cohesion — only cross-layer and file-level aliases flip.
//   - `src/config.ts` and `src/composition.ts` map to single-file aliases.
//
// Usage:
//   bun run scripts/rewrite-imports.ts           # rewrites src/ in place
//   bun run scripts/rewrite-imports.ts --dry     # prints diffs only
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { Glob } from "bun";

const DRY_RUN = process.argv.includes("--dry");
const SRC_ROOT = resolve("src");

// Layer aliases: `src/<layer>/foo.ts` → `@layer/foo.ts`
const LAYER_ALIAS: Record<string, string> = {
  core: "@core",
  adapters: "@adapters",
  mcp: "@mcp",
  cli: "@cli",
};

// Single-file aliases
const FILE_ALIAS: Record<string, string> = {
  "config.ts": "@config",
  "composition.ts": "@composition",
};

// from "…"  or  from '…'
const IMPORT_RE = /(from\s+["'])((?:\.{1,2}\/)[^"']+)(["'])/g;

interface Change {
  file: string;
  before: string;
  after: string;
}

function resolveAlias(sourceFile: string, spec: string): string | null {
  const dir = dirname(sourceFile);
  const absTarget = resolve(dir, spec);
  const rel = relative(SRC_ROOT, absTarget);
  if (rel.startsWith("..") || rel.startsWith(`..${sep}`)) return null; // outside src
  const parts = rel.split(sep);

  // Single-file aliases (top-level src/*.ts)
  if (parts.length === 1 && FILE_ALIAS[parts[0]]) {
    return FILE_ALIAS[parts[0]];
  }

  const [layer, ...rest] = parts;
  if (rest.length === 0) return null;
  const alias = LAYER_ALIAS[layer];
  if (!alias) return null;

  // Preserve relative form for intra-layer imports (cohesion)
  const sourceRel = relative(SRC_ROOT, sourceFile);
  const [sourceLayer] = sourceRel.split(sep);
  if (sourceLayer === layer) return null;

  return `${alias}/${rest.join("/")}`;
}

const changes: Change[] = [];
let filesModified = 0;

for await (const path of new Glob("src/**/*.ts").scan(".")) {
  const absFile = resolve(path);
  const src = readFileSync(absFile, "utf-8");
  const hits: Array<{ spec: string; alias: string }> = [];

  const next = src.replace(IMPORT_RE, (_m, p1, spec, p3) => {
    const alias = resolveAlias(absFile, spec);
    if (!alias) return `${p1}${spec}${p3}`;
    hits.push({ spec, alias });
    return `${p1}${alias}${p3}`;
  });

  if (next !== src) {
    filesModified++;
    for (const h of hits) {
      changes.push({ file: relative(".", absFile), before: h.spec, after: h.alias });
    }
    if (!DRY_RUN) writeFileSync(absFile, next);
  }
}

process.stdout.write(
  `\n${DRY_RUN ? "[DRY-RUN] " : ""}rewrote ${changes.length} imports across ${filesModified} files\n\n`,
);

// Collapse duplicates for a concise summary
const counts = new Map<string, number>();
for (const c of changes) {
  const key = `${c.before} → ${c.after}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
const top = Array.from(counts.entries())
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15);
for (const [key, n] of top) {
  process.stdout.write(`  ${String(n).padStart(3)}×  ${key}\n`);
}
if (counts.size > top.length) {
  process.stdout.write(`  … and ${counts.size - top.length} more distinct mappings\n`);
}
