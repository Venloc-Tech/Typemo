/*
 * `@venloc/typemo/testing` is a public entry point of the core package: it is in `exports`, and its runtime
 * import graph reaches only the core's own files and its dependencies — never the private test-kit,
 * `mongodb-memory-server` or `mongoose` (devDependencies of the test-kit only).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const PACKAGE = resolve(import.meta.dir, "../../..");
const ENTRY = resolve(PACKAGE, "src/testing/index.ts");

/** Every module the entry point imports at run time (type-only imports are erased), transitively. */
const graph = (entry: string): { readonly files: Set<string>; readonly packages: Set<string> } => {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string): void => {
    if (files.has(file)) return;
    files.add(file);
    for (const { path } of transpiler.scanImports(readFileSync(file, "utf8"))) {
      if (path.startsWith(".")) {
        const target = resolve(dirname(file), path);
        if (existsSync(target)) visit(target);
      } else
        packages.add(
          path
            .split("/")
            .slice(0, path.startsWith("@") ? 2 : 1)
            .join("/"),
        );
    }
  };
  visit(entry);
  return { files, packages };
};

describe("@venloc/typemo/testing", () => {
  test("is exported by the package", () => {
    const manifest = JSON.parse(readFileSync(resolve(PACKAGE, "package.json"), "utf8")) as {
      exports: Record<string, { types: string; import: string }>;
      dependencies: Record<string, string>;
    };
    /* The published entry points at the built files; the sources of it are what the import graph below reads. */
    expect(manifest.exports["./testing"]).toEqual({
      types: "./dist/testing/index.d.ts",
      import: "./dist/testing/index.js",
    });
    expect(Object.keys(manifest.dependencies)).toEqual(["reflect-metadata"]);
  });

  test("imports no test-only package at run time", () => {
    const { files, packages } = graph(ENTRY);
    const allowed = new Set(["mongodb", "bson", "reflect-metadata"]);
    const external = [...packages].filter((name) => !name.startsWith("node:") && !allowed.has(name));
    expect(external).toEqual([]);
    expect([...files].every((file) => file.startsWith(resolve(PACKAGE, "src")))).toBe(true);
  });
});
