/**
 * Publishes the public packages of the monorepo to npm with `bun publish`, in dependency order (the core first).
 *
 * The root `package.json` is a private workspace and has no version: `bun publish` runs in each package folder. The
 * script builds everything first (`bun run build` also copies the agent skills into the packages), checks that every
 * package has the same version and is not private, skips a version that is already on the registry, and stops at the
 * first failure.
 *
 * Usage:
 * ```bash
 * bun scripts/publish.ts --dry-run          # everything except the upload
 * bun scripts/publish.ts                    # publish (asks npm for the one-time code if 2FA requires it)
 * bun scripts/publish.ts --otp 123456       # pass the one-time code
 * bun scripts/publish.ts --tag next         # a dist-tag other than `latest`
 * bun scripts/publish.ts --skip-build       # when `bun run build` already ran
 * ```
 * Authentication: `bunx npm login` (token in `~/.npmrc`) or `NPM_CONFIG_TOKEN` in the environment.
 */

import { join } from "node:path";

/** The public packages, in the order they must be published (each depends only on earlier ones). */
const PACKAGES = [
  "packages/typemo",
  "packages/decorators",
  "integrations/opentelemetry",
  "integrations/sentry",
  "integrations/nestjs",
] as const;

const ROOT = join(import.meta.dir, "..");

/** The command line of one run. */
interface PublishArgs {
  readonly dryRun: boolean;
  readonly skipBuild: boolean;
  readonly otp: string | undefined;
  readonly tag: string | undefined;
}

/** Reading and checking the packages, running the commands. */
class Publisher {
  /**
   * Parses the command line.
   *
   * @param argv - The arguments after the script name.
   * @returns The parsed options.
   */
  static args(argv: readonly string[]): PublishArgs {
    const value = (flag: string): string | undefined => {
      const at = argv.indexOf(flag);
      return at === -1 ? undefined : argv[at + 1];
    };
    return {
      dryRun: argv.includes("--dry-run"),
      skipBuild: argv.includes("--skip-build"),
      otp: value("--otp"),
      tag: value("--tag"),
    };
  }

  /**
   * Runs a command in a folder with the output shown, and fails on a non-zero exit.
   *
   * @param cmd - The command and its arguments.
   * @param cwd - The folder.
   */
  static run(cmd: readonly string[], cwd: string): void {
    console.log(`\n$ ${cmd.join(" ")}   (${cwd.replace(`${ROOT}/`, "") || "."})`);
    const result = Bun.spawnSync([...cmd], { cwd, stdout: "inherit", stderr: "inherit", env: process.env });
    if (result.exitCode !== 0) throw new Error(`"${cmd.join(" ")}" failed with exit code ${result.exitCode}`);
  }

  /**
   * Tells whether this exact version of a package is already on the registry.
   *
   * @param name - The package name.
   * @param version - The version.
   * @returns `true` when `bun pm view` finds it.
   */
  static published(name: string, version: string): boolean {
    const result = Bun.spawnSync(["bun", "pm", "view", `${name}@${version}`, "version"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    return result.exitCode === 0 && result.stdout.toString().trim() === version;
  }

  /**
   * Reads the manifests and checks them: not private, one version for all, a license, a `files` list.
   *
   * @returns The name and version of each package, in publishing order.
   */
  static async manifests(): Promise<
    readonly { readonly dir: string; readonly name: string; readonly version: string }[]
  > {
    const list = await Promise.all(
      PACKAGES.map(async (dir) => {
        const json = (await Bun.file(join(ROOT, dir, "package.json")).json()) as Record<string, unknown>;
        const problems: string[] = [];
        if (json.private === true) problems.push("is private");
        if (typeof json.version !== "string") problems.push("has no version");
        if (json.license !== "MIT") problems.push('license is not "MIT"');
        if (!Array.isArray(json.files)) problems.push("has no files list");
        if (problems.length > 0) throw new Error(`${dir}/package.json ${problems.join(", ")}`);
        return { dir, name: json.name as string, version: json.version as string };
      }),
    );
    const versions = new Set(list.map((entry) => entry.version));
    if (versions.size > 1)
      throw new Error(`the packages have different versions: ${list.map((e) => `${e.name}@${e.version}`).join(", ")}`);
    return list;
  }
}

const args = Publisher.args(process.argv.slice(2));
const packages = await Publisher.manifests();
console.log(
  `publishing ${packages.length} packages, version ${packages[0]?.version}${args.dryRun ? " (dry run)" : ""}`,
);

if (!args.skipBuild) Publisher.run(["bun", "run", "build"], ROOT);

for (const pkg of packages) {
  if (!args.dryRun && Publisher.published(pkg.name, pkg.version)) {
    console.log(`\n${pkg.name}@${pkg.version} is already on the registry: skipped`);
    continue;
  }
  const cmd = ["bun", "publish"];
  if (args.dryRun) cmd.push("--dry-run");
  if (args.otp !== undefined) cmd.push("--otp", args.otp);
  if (args.tag !== undefined) cmd.push("--tag", args.tag);
  Publisher.run(cmd, join(ROOT, pkg.dir));
}

console.log(`\ndone${args.dryRun ? " (dry run: nothing was uploaded)" : ""}`);
