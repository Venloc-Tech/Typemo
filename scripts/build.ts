/*
 * Builds the published packages into `dist/` (`.js` + `.d.ts`, ESM): `@venloc/typemo`, `@venloc/typemo-decorators`,
 * `@venloc/typemo-opentelemetry`, `@venloc/typemo-sentry`, `@venloc/typemo-nestjs`. Each package has a `tsconfig.build.json` (no project
 * references, `stripInternal`, `rewriteRelativeImportExtensions` so the `.ts` imports of the sources become `.js`).
 * The order matters: the decorators and the integrations compile against the BUILT declarations of the core.
 * `tsc` rewrites the extensions only in the emitted JavaScript, so the declaration files are rewritten here (a
 * relative `./x.ts` in a `.d.ts` becomes `./x.js`, which TypeScript resolves to `x.d.ts` in any consumer setup).
 * `dist` is removed first, so a deleted source never leaves a stale file in the package.
 *
 * The agent skills (`skills/typemo`, `skills/typemo-nestjs`) are copied into the package directory as `skills/<name>`
 * (gitignored there; the single source stays in the root `skills/`), so `files: ["dist", "skills"]` ships them.
 *
 * Usage: `bun run build` (all packages) or `bun scripts/build.ts <package-dir> [...]` (for example
 * `bun scripts/build.ts packages/typemo`; `.` inside a package directory builds that package).
 */
import { copyFileSync, cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/** A relative specifier that ends in `.ts` inside a declaration file: `from "./x.ts"`, `import("./x.ts")`, `import "./x.ts"`. */
const TS_SPECIFIER = /((?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(["']))(\.{1,2}\/[^"']*?)\.ts\2/g;

/** Builds the packages that are published. */
class PackageBuild {
  /** The repository root. */
  static readonly root = resolve(import.meta.dir, "..");
  /** The published packages, in build order (the core first). */
  static readonly packages: readonly string[] = [
    "packages/typemo",
    "packages/decorators",
    "integrations/opentelemetry",
    "integrations/sentry",
    "integrations/nestjs",
  ];

  /** The skill of each package: package directory -> skill folder name under the root `skills/`. */
  static readonly skills: Readonly<Record<string, string>> = {
    "packages/typemo": "typemo",
    "integrations/nestjs": "typemo-nestjs",
  };

  /**
   * Copies the skill of a package into `<package>/skills/<name>` (replacing a previous copy).
   *
   * @param dir - The package directory, absolute.
   */
  static copySkill(dir: string): void {
    const name = PackageBuild.skills[relative(PackageBuild.root, dir)];
    if (name === undefined) return;
    const target = join(dir, "skills");
    rmSync(target, { recursive: true, force: true });
    cpSync(join(PackageBuild.root, "skills", name), join(target, name), { recursive: true });
  }

  /**
   * Copies the root `LICENSE` into a package directory, so the published tarball carries the license text
   * (the repository keeps one `LICENSE`, at the root; the copies are gitignored).
   *
   * @param dir - The package directory, absolute.
   */
  static copyLicense(dir: string): void {
    copyFileSync(join(PackageBuild.root, "LICENSE"), join(dir, "LICENSE"));
  }

  /**
   * Every file below a directory.
   *
   * @param dir - The directory.
   * @returns Absolute file paths.
   */
  static files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? PackageBuild.files(path) : [path];
    });
  }

  /**
   * Rewrites the `.ts` specifiers of the declaration files of a built package to `.js`.
   *
   * @param dist - The `dist` directory of the package.
   * @returns How many files changed.
   */
  static rewriteDeclarations(dist: string): number {
    let changed = 0;
    for (const file of PackageBuild.files(dist)) {
      if (!file.endsWith(".d.ts")) continue;
      const text = readFileSync(file, "utf8");
      const rewritten = text.replace(
        TS_SPECIFIER,
        (_all, head: string, quote: string, path: string) => `${head}${path}.js${quote}`,
      );
      if (rewritten !== text) {
        writeFileSync(file, rewritten);
        changed += 1;
      }
    }
    return changed;
  }

  /**
   * Builds one package.
   *
   * @param dir - The package directory, absolute.
   * @returns `true` when `tsc` succeeded.
   */
  static async one(dir: string): Promise<boolean> {
    const label = relative(PackageBuild.root, dir);
    if (!existsSync(join(dir, "tsconfig.build.json"))) {
      console.error(`build: ${label} has no tsconfig.build.json`);
      return false;
    }
    rmSync(join(dir, "dist"), { recursive: true, force: true });
    const started = performance.now();
    const proc = Bun.spawn(
      ["bun", join(PackageBuild.root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"],
      {
        cwd: dir,
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    const ok = (await proc.exited) === 0;
    if (ok) {
      PackageBuild.rewriteDeclarations(join(dir, "dist"));
      PackageBuild.copySkill(dir);
      PackageBuild.copyLicense(dir);
    }
    console.log(`build: ${label} ${ok ? "ok" : "FAILED"} (${Math.round(performance.now() - started)} ms)`);
    return ok;
  }

  /**
   * Builds the packages named on the command line, or all of them.
   *
   * @param argv - Package directories (relative to the current directory).
   * @returns The process exit code.
   */
  static async run(argv: readonly string[]): Promise<number> {
    const dirs =
      argv.length > 0
        ? argv.map((dir) => resolve(dir))
        : PackageBuild.packages.map((dir) => join(PackageBuild.root, dir));
    for (const dir of dirs) if (!(await PackageBuild.one(dir))) return 1;
    return 0;
  }
}

process.exit(await PackageBuild.run(process.argv.slice(2)));
