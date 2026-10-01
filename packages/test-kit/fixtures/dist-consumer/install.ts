/*
 * Installs the BUILT packages into the consumer project the way a package manager would, without the network:
 * `bun pm pack` makes the tarball of each package (only what its `files` field lists), the tarball is extracted
 * into `node_modules/<name>`, and the peer dependencies (the driver, `bson`, `reflect-metadata`, the Node types,
 * the integrations' vendor packages, NestJS and rxjs) are linked from the repository's own `node_modules`.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** The repository root (this file is `packages/test-kit/fixtures/dist-consumer/install.ts`). */
const ROOT = resolve(import.meta.dir, "../../../..");

/** The consumer project directory. */
export const PROJECT = import.meta.dir;

/** One published package: its name and where it lives. */
interface PublishedPackage {
  /** The package name. */
  readonly name: string;
  /** Its directory, relative to the repository root. */
  readonly dir: string;
}

/** The packages that are published, in the order they are installed. */
export const PUBLISHED: readonly PublishedPackage[] = [
  { name: "@venloc/typemo", dir: "packages/typemo" },
  { name: "@venloc/typemo-decorators", dir: "packages/decorators" },
  { name: "@venloc/typemo-opentelemetry", dir: "integrations/opentelemetry" },
  { name: "@venloc/typemo-sentry", dir: "integrations/sentry" },
  { name: "@venloc/typemo-nestjs", dir: "integrations/nestjs" },
];

/** Packs, extracts and links the packages into the consumer project. */
export class DistInstall {
  /**
   * Runs a command and throws with its output when it fails.
   *
   * @param command - The program and its arguments.
   * @param cwd - The working directory.
   * @returns The standard output.
   * @throws Error - When the exit code is not zero.
   */
  static run(command: readonly string[], cwd: string): string {
    const result = Bun.spawnSync([...command], { cwd, stdout: "pipe", stderr: "pipe" });
    const text = `${result.stdout.toString()}${result.stderr.toString()}`;
    if (result.exitCode !== 0) throw new Error(`${command.join(" ")} failed (${result.exitCode}):\n${text}`);
    return text;
  }

  /**
   * Links a package of the repository's `node_modules` into the consumer's `node_modules`.
   *
   * @param name - The package name.
   * @param from - A directory of the repository whose `node_modules` has it.
   */
  static link(name: string, from: string): void {
    DistInstall.linkTo(name, realpathSync(resolve(ROOT, from, "node_modules", name)));
  }

  /**
   * Links a directory as a package of the consumer's `node_modules`.
   *
   * @param name - The package name.
   * @param source - The directory to link.
   */
  static linkTo(name: string, source: string): void {
    const target = join(PROJECT, "node_modules", name);
    mkdirSync(dirname(target), { recursive: true });
    rmSync(target, { recursive: true, force: true });
    symlinkSync(source, target, "dir");
  }

  /**
   * Makes `project/node_modules` with the packed packages and the linked peers.
   *
   * @returns The versions of the installed packages' manifests (name to the files they ship).
   */
  static install(): Record<string, number> {
    rmSync(join(PROJECT, "node_modules"), { recursive: true, force: true });
    const work = mkdtempSync(join(tmpdir(), "typemo-dist-"));
    const shipped: Record<string, number> = {};
    try {
      for (const pkg of PUBLISHED) {
        const dir = resolve(ROOT, pkg.dir);
        DistInstall.run(["bun", "pm", "pack", "--destination", work, "--quiet"], dir);
        const tarball = readdirSync(work).find((file) => file.endsWith(".tgz") && !(file in shipped));
        if (tarball === undefined) throw new Error(`no tarball for ${pkg.name}`);
        const target = join(PROJECT, "node_modules", pkg.name);
        mkdirSync(target, { recursive: true });
        DistInstall.run(["tar", "-xzf", join(work, tarball), "-C", target, "--strip-components=1"], PROJECT);
        shipped[pkg.name] = DistInstall.count(target);
        rmSync(join(work, tarball));
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
    DistInstall.link("mongodb", "packages/typemo");
    DistInstall.link("bson", "packages/typemo");
    DistInstall.link("reflect-metadata", "packages/typemo");
    /* The Node types live in Bun's package store, next to `@types/bun`, which needs them. */
    const store = join(ROOT, "node_modules/.bun");
    const nodeTypes = readdirSync(store).find((entry) => entry.startsWith("@types+node@"));
    if (nodeTypes === undefined) throw new Error("@types/node is not installed in the repository");
    DistInstall.linkTo("@types/node", join(store, nodeTypes, "node_modules/@types/node"));
    DistInstall.link("@opentelemetry/api", "integrations/opentelemetry");
    DistInstall.link("@sentry/core", "integrations/sentry");
    for (const name of ["@nestjs/common", "@nestjs/core", "@nestjs/platform-express", "rxjs"]) {
      DistInstall.link(name, "integrations/nestjs");
    }
    return shipped;
  }

  /**
   * How many files a directory holds.
   *
   * @param dir - The directory.
   * @returns The file count.
   */
  static count(dir: string): number {
    return readdirSync(dir, { withFileTypes: true, recursive: true }).filter((entry) => entry.isFile()).length;
  }

  /**
   * Whether the packages were built (the `dist` of each exists).
   *
   * @returns `true` when every package has a `dist/index.js`.
   */
  static built(): boolean {
    return PUBLISHED.every((pkg) => existsSync(resolve(ROOT, pkg.dir, "dist/index.js")));
  }
}
