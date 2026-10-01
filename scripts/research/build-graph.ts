/*
 * Builds research/graph.json: module dependency graph for mongoose (lib/, CommonJS),
 * the mongodb driver (src/, TS) and bson (src/, TS).
 *
 * Usage: `bun scripts/research/build-graph.ts`
 */

import { dirname, join, relative, resolve } from "node:path";
import { Glob } from "bun";

/** The directory with the reference sources. */
const root = resolve(import.meta.dir, "../../references");

/**
 * One module of a graph.
 *
 * @example
 * ```ts
 * const node: Node = { file: "lib/index.js", lines: 10, imports: [], importedBy: [], external: [] };
 * ```
 */
interface Node {
  /** Path relative to the package directory. */
  file: string;
  /** Line count. */
  lines: number;
  /** Modules this one imports. */
  imports: string[];
  /** Modules that import this one. */
  importedBy: string[];
  /** Imported packages that are not part of the graph. */
  external: string[];
}

/** The packages that are scanned. */
const sources = [
  { name: "mongoose", dir: "mongoose-master", pattern: "lib/**/*.js", re: /require\(\s*['"]([^'"]+)['"]\s*\)/g },
  { name: "mongodb", dir: "mongodb-7.6.0", pattern: "src/**/*.ts", re: /(?:from|import)\s*['"]([^'"]+)['"]/g },
  { name: "bson", dir: "bson-7.3.3", pattern: "src/**/*.ts", re: /(?:from|import)\s*['"]([^'"]+)['"]/g },
];

/** The suffixes tried when resolving a relative import. */
const exts = ["", ".js", ".ts", "/index.js", "/index.ts"];

/** The graph of every package by file. */
const graph: Record<string, Record<string, Node>> = {};

for (const src of sources) {
  const base = join(root, src.dir);
  const nodes: Record<string, Node> = {};
  const files = [...new Glob(src.pattern).scanSync(base)].sort();
  const known = new Set(files);

  for (const file of files) {
    const text = await Bun.file(join(base, file)).text();
    const node: Node = { file, lines: text.split("\n").length, imports: [], importedBy: [], external: [] };
    for (const m of text.matchAll(src.re)) {
      const spec = m[1]!;
      if (!spec.startsWith(".")) {
        if (!node.external.includes(spec)) node.external.push(spec);
        continue;
      }
      const target = relative(base, resolve(base, dirname(file), spec));
      const hit = exts.map((e) => target + e).find((c) => known.has(c));
      if (hit && !node.imports.includes(hit)) node.imports.push(hit);
    }
    nodes[file] = node;
  }
  for (const node of Object.values(nodes)) {
    for (const dep of node.imports) nodes[dep]?.importedBy.push(node.file);
  }
  graph[src.name] = nodes;
}

/** The output file. */
const out = resolve(import.meta.dir, "../../research/graph.json");
await Bun.write(out, JSON.stringify(graph, null, 2) + "\n");
for (const [name, nodes] of Object.entries(graph)) {
  const n = Object.values(nodes);
  console.log(
    name,
    n.length,
    "files,",
    n.reduce((s, x) => s + x.imports.length, 0),
    "edges",
  );
}
