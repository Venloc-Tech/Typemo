import os from "node:os";
import path from "node:path";
import { MongoClient } from "mongodb";
import type { BenchContext } from "../adapters/bench-context.ts";
import type { Environment } from "./types.ts";

/** The driver version every contestant must resolve. */
const PINNED_DRIVER = "7.6.0";

/**
 * Runs a command and returns its trimmed output.
 *
 * @param cmd - The command and its arguments.
 * @param cwd - The working directory.
 * @returns The output, or `unknown` when the command fails.
 */
const run = (cmd: readonly string[], cwd?: string): string => {
  try {
    const out = Bun.spawnSync([...cmd], { ...(cwd !== undefined ? { cwd } : {}), stdout: "pipe", stderr: "ignore" });
    return out.success ? out.stdout.toString().trim() : "unknown";
  } catch {
    return "unknown";
  }
};

/**
 * The installed version of a package as resolved from a directory.
 *
 * @param specifier - The package name.
 * @param from - The directory to resolve from.
 * @returns The version, or `unknown` when it cannot be resolved.
 */
const versionOf = async (specifier: string, from: string): Promise<string> => {
  try {
    const file = Bun.resolveSync(`${specifier}/package.json`, from);
    const json = (await Bun.file(file).json()) as { readonly version?: string };
    return json.version ?? "unknown";
  } catch {
    return "unknown";
  }
};

/** Environment capture and the runtime driver pin check. */
export class EnvironmentCapture {
  /** The bench package directory. */
  static readonly packageDir = path.resolve(import.meta.dir, "../..");

  /**
   * Where Mongoose resolves `mongodb` from, and its version.
   *
   * @returns The driver version Mongoose uses.
   */
  static async mongooseDriverVersion(): Promise<string> {
    const mongooseDir = path.dirname(Bun.resolveSync("mongoose/package.json", EnvironmentCapture.packageDir));
    return versionOf("mongodb", mongooseDir);
  }

  /**
   * Fails loudly unless the driver used by the bench, by Typemo and by Mongoose is the same 7.6.0 — and the
   * same module instance (Mongoose's `MongoClient` class is ours).
   *
   * @param ctx - The contestants' connections.
   * @throws Error - When a contestant resolves another driver version or module instance.
   */
  static async assertPinnedDriver(ctx: BenchContext): Promise<void> {
    const ours = await versionOf("mongodb", EnvironmentCapture.packageDir);
    const typemoDir = path.dirname(Bun.resolveSync("@venloc/typemo/package.json", EnvironmentCapture.packageDir));
    const typemo = await versionOf("mongodb", typemoDir);
    const mongoose = await EnvironmentCapture.mongooseDriverVersion();
    const problems: string[] = [];
    for (const [who, version] of [
      ["bench", ours],
      ["typemo", typemo],
      ["mongoose", mongoose],
    ] as const) {
      if (version !== PINNED_DRIVER) problems.push(`${who} resolves mongodb ${version}, expected ${PINNED_DRIVER}`);
    }
    if (!(ctx.mongoose.mongo instanceof MongoClient))
      problems.push("Mongoose's MongoClient is another module instance");
    if (!(ctx.typemo.mongo instanceof MongoClient)) problems.push("Typemo's MongoClient is another module instance");
    if (problems.length > 0) throw new Error(`driver pin check failed: ${problems.join("; ")}`);
  }

  /**
   * Captures the machine and software of the run.
   *
   * @param ctx - The contestants' connections.
   * @returns The environment description.
   */
  static async capture(ctx: BenchContext): Promise<Environment> {
    const admin = ctx.driver.client.db("admin");
    const build = await admin.command({ buildInfo: 1 }).catch(() => ({ version: "unknown" }));
    const hello = await admin.command({ hello: 1 }).catch(() => ({}) as Record<string, unknown>);
    const cpus = os.cpus();
    const root = path.resolve(EnvironmentCapture.packageDir, "../..");
    const typemoPkg = (await Bun.file(path.join(root, "packages/typemo/package.json")).json()) as { version: string };
    return {
      date: new Date().toISOString(),
      machine: os.hostname().replace(/\.local$/, ""),
      cpu: cpus[0]?.model ?? "unknown",
      cores: cpus.length,
      memoryGb: Math.round(os.totalmem() / 1024 ** 3),
      os: `${os.type()} ${os.release()} ${os.arch()}`,
      bun: Bun.version,
      mongodb: String((build as { version?: unknown }).version ?? "unknown"),
      mongodbTopology: typeof hello.setName === "string" ? `replica set ${hello.setName} (1 node)` : "standalone",
      driver: await versionOf("mongodb", EnvironmentCapture.packageDir),
      mongooseDriver: await EnvironmentCapture.mongooseDriverVersion(),
      mongoose: await versionOf("mongoose", EnvironmentCapture.packageDir),
      typemo: `${typemoPkg.version} @ ${run(["git", "rev-parse", "--short", "HEAD"], root)}`,
      mitata: await versionOf("mitata", EnvironmentCapture.packageDir),
      gitCommit: run(["git", "rev-parse", "HEAD"], root),
      gitBranch: run(["git", "rev-parse", "--abbrev-ref", "HEAD"], root),
      dockerImage: run(["docker", "inspect", "typemo-bench-mongo", "--format", "{{.Config.Image}}"]),
    };
  }
}
