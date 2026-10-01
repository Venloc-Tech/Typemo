/*
 * Removes orphaned declaration files of the type-check output (`.typecheck`; `dist` is the published build). `tsc -b` never deletes the output of a removed source, so `.typecheck` keeps
 * orphans that `grep` finds as "live" code. Run before `tsc -b` (`bun run typecheck`): every
 * `.typecheck/**\/*.d.ts(.map)` of a package without its `src/**\/*.ts` is removed. Only orphans go — the
 * incremental build (`.tsbuildinfo`, current outputs) is kept, so `tsc -b` stays incremental.
 *
 * Usage: `bun scripts/clean-dist.ts`
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

/** The repository root. */
const ROOT = join(import.meta.dir, "..");
/** The directories that hold the workspace packages. */
const GROUPS = ["packages", "integrations"].map((group) => join(ROOT, group));

/** Matches a declaration file or its map. */
const DECLARATION = /\.d\.ts(\.map)?$/;

/**
 * Every file below a directory.
 *
 * @param dir - The directory.
 * @returns Absolute file paths.
 */
const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });

/**
 * The declaration files of a package whose source no longer exists.
 *
 * @param pkg - The package directory.
 * @returns Absolute paths of the orphans.
 */
const orphansOf = (pkg: string): string[] => {
  const dist = join(pkg, ".typecheck");
  const src = join(pkg, "src");
  if (!existsSync(dist) || !existsSync(src)) return [];
  return filesUnder(dist).filter((file) => {
    if (!DECLARATION.test(file)) return false;
    const base = relative(dist, file).replace(DECLARATION, "");
    return !existsSync(join(src, `${base}.ts`)) && !existsSync(join(src, `${base}.tsx`));
  });
};

/** The orphans found in every package; they are removed below. */
const removed = GROUPS.flatMap((group) =>
  readdirSync(group, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => orphansOf(join(group, entry.name))),
);
for (const file of removed) rmSync(file);
if (removed.length > 0) {
  console.log(
    `clean-dist: removed ${removed.length} orphan(s):\n${removed.map((f) => `  ${relative(ROOT, f)}`).join("\n")}`,
  );
}
