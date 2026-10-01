/*
 * `bun run check:any`: checks the "no `any` in the public API" rule for every export entry of every
 * workspace package (their `package.json` `exports`). The scan itself is test-kit's
 * `NoAnyInPublicApi`; this script only picks the entries and prints the report.
 *
 * Usage: `bun run check:any` (all packages) or `bun run check:any <entry.ts> [...]`.
 */

import { readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  type AnyAllowEntry,
  NoAnyInPublicApi,
  type NoAnyReport,
} from "../packages/test-kit/src/guards/no-any-in-public-api.ts";

/**
 * Agreed exceptions, keyed by repo-relative entry file. Every entry must be agreed with
 * the user and carry the reason. Empty until the first agreed exception.
 */
const ALLOWLIST: Readonly<Record<string, readonly AnyAllowEntry[]>> = {};

/** One `exports` value of a package.json: a file, or an object of conditions. */
type ExportTarget = string | { readonly types?: string; readonly import?: string; readonly default?: string };

/** The command-line front end of the `any` guard. */
class CheckAnyCli {
  /** The repository root. */
  static readonly repoRoot = resolve(import.meta.dir, "..");

  /**
   * The source file behind one `exports` target: a string is the file itself; a conditions object is read through its
   * `types` condition (`./dist/x.d.ts` becomes `./src/x.ts`).
   *
   * @param target - The `exports` value of one entry.
   * @returns The source file, relative to the package.
   */
  static sourceOf(target: ExportTarget): string {
    const file = typeof target === "string" ? target : (target.types ?? target.import ?? target.default ?? "");
    return file
      .replace(/^\.\/dist\//, "./src/")
      .replace(/\.d\.ts$/, ".ts")
      .replace(/\.js$/, ".ts");
  }

  /**
   * Every `exports` entry of every workspace package.json (`packages/*`, `integrations/*`), as its SOURCE file. The
   * published packages point `exports` at the built declarations (`./dist/index.d.ts`); the scan reads the source that
   * makes them (`./src/index.ts`), where the rules and comments live.
   *
   * @returns Repo-relative entry files.
   */
  static async workspaceEntries(): Promise<string[]> {
    const entries: string[] = [];
    for (const group of ["packages", "integrations"]) {
      const groupDir = resolve(CheckAnyCli.repoRoot, group);
      for (const name of readdirSync(groupDir).sort()) {
        const manifest = Bun.file(resolve(groupDir, name, "package.json"));
        if (!(await manifest.exists())) continue;
        const { exports } = (await manifest.json()) as { exports?: Record<string, ExportTarget> | string };
        const targets =
          typeof exports === "string"
            ? [exports]
            : Object.values(exports ?? {})
                .map(CheckAnyCli.sourceOf)
                .filter((file) => !file.endsWith(".json"));
        for (const target of targets) entries.push(relative(CheckAnyCli.repoRoot, resolve(groupDir, name, target)));
      }
    }
    return entries;
  }

  /**
   * Scans the entries and prints the reports.
   *
   * @param argv - Entry files; every workspace entry when empty.
   * @returns The process exit code: `1` when any entry has findings.
   */
  static async run(argv: readonly string[]): Promise<number> {
    const entries =
      argv.length > 0
        ? argv.map((entry) => relative(CheckAnyCli.repoRoot, resolve(entry)))
        : await CheckAnyCli.workspaceEntries();
    const failed: NoAnyReport[] = [];
    for (const entry of entries) {
      const report = NoAnyInPublicApi.scan({ entry, allowlist: ALLOWLIST[entry] ?? [] });
      const text = NoAnyInPublicApi.format(report);
      const allowedNote = report.allowed.length > 0 ? `, ${report.allowed.length} allowlisted` : "";
      if (text === "") {
        console.log(`check-any: ok  ${entry} (${report.exports.length} exports${allowedNote})`);
      } else {
        failed.push(report);
        console.error(text);
      }
    }
    return failed.length === 0 ? 0 : 1;
  }
}

process.exit(await CheckAnyCli.run(process.argv.slice(2)));
