/*
 * `bun run test:dist`: builds the published packages (`bun run build`), then runs the consumer test of the compiled
 * library (`packages/test-kit/fixtures/dist-consumer/dist-consumer.suite.ts`): the packed packages are installed into
 * a plain consumer project that compiles against them, compares hovers and errors with the sources' and runs a smoke
 * on a real MongoDB under Node. Not part of `bun run test`; `--skip-build` reuses the current `dist`.
 *
 * Usage: `bun run test:dist [--skip-build] [bun test options]`
 */
import { resolve } from "node:path";

/** The repository root. */
const ROOT = resolve(import.meta.dir, "..");
/** The consumer suite. */
const SUITE = "./packages/test-kit/fixtures/dist-consumer/dist-consumer.suite.ts";

/** Runs the build and the consumer suite. */
class DistTest {
  /**
   * Runs a command in the repository root with inherited output.
   *
   * @param command - The program and its arguments.
   * @returns The exit code.
   */
  static async run(command: readonly string[]): Promise<number> {
    const proc = Bun.spawn([...command], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
    return proc.exited;
  }

  /**
   * Builds (unless skipped) and tests.
   *
   * @param argv - `--skip-build` and options for `bun test`.
   * @returns The exit code.
   */
  static async main(argv: readonly string[]): Promise<number> {
    const skip = argv.includes("--skip-build");
    const rest = argv.filter((arg) => arg !== "--skip-build");
    if (!skip) {
      const built = await DistTest.run(["bun", "scripts/build.ts"]);
      if (built !== 0) return built;
    }
    return DistTest.run(["bun", "test", SUITE, ...rest]);
  }
}

process.exit(await DistTest.main(process.argv.slice(2)));
