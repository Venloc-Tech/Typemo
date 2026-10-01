import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import type { RunResult } from "../harness/types.ts";

/** Raw results: `packages/bench/results/<date>-<machine>-<commit>-<profile>.json`. */
export class ResultStore {
  /** The results directory. */
  static readonly DIR = path.resolve(import.meta.dir, "../../results");

  /**
   * The file name of a run.
   *
   * @param run - The run.
   * @returns `<date>-<machine>-<commit>-<profile>.json`.
   */
  static fileName(run: RunResult): string {
    const date = run.startedAt.replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
    const machine = run.environment.machine.replace(/[^A-Za-z0-9_-]/g, "_");
    return `${date}-${machine}-${run.environment.gitCommit.slice(0, 7)}-${run.profile}.json`;
  }

  /**
   * Saves a run as JSON.
   *
   * @param run - The run.
   * @param dir - The target directory.
   * @returns The written file.
   */
  static async save(run: RunResult, dir: string = ResultStore.DIR): Promise<string> {
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, ResultStore.fileName(run));
    await Bun.write(file, `${JSON.stringify(run, null, 2)}\n`);
    return file;
  }

  /**
   * Loads a saved run.
   *
   * @param file - The result file.
   * @returns The run.
   * @throws Error - When the file has an unsupported version.
   */
  static async load(file: string): Promise<RunResult> {
    const run = (await Bun.file(file).json()) as RunResult;
    if (run.version !== 1) throw new Error(`${file}: unsupported result version ${String(run.version)}`);
    return run;
  }

  /**
   * Merges runs of the same profile: a later run (e.g. a re-measure of a few scenarios after a harness fix)
   * replaces the scenario×size results it contains; the file column names both files and the replaced ids.
   *
   * @param runs - The runs, oldest first.
   * @returns One run per profile.
   */
  static mergeByProfile(runs: readonly RunResult[]): RunResult[] {
    const out = new Map<string, RunResult>();
    for (const run of runs) {
      const base = out.get(run.profile);
      if (base === undefined) {
        out.set(run.profile, run);
        continue;
      }
      const key = (s: { readonly id: string; readonly size: string }): string => `${s.id}|${s.size}`;
      const replaced = new Map(run.scenarios.map((s) => [key(s), s]));
      const ids = [...replaced.keys()].map((k) => k.replace("|", " ")).join(", ");
      out.set(run.profile, {
        ...base,
        scenarios: base.scenarios.map((s) => replaced.get(key(s)) ?? s),
        settings: {
          ...base.settings,
          file: `${String(base.settings.file ?? "")} + ${String(run.settings.file ?? "")} (перезамер: ${ids})`,
        },
      });
    }
    return [...out.values()];
  }

  /**
   * The newest result file of a profile, excluding `except`.
   *
   * @param profile - The profile name.
   * @param except - A file to skip.
   * @param dir - The results directory.
   * @returns The path, or `undefined` when there is none.
   */
  static async latest(profile: string, except?: string, dir: string = ResultStore.DIR): Promise<string | undefined> {
    const files = (await readdir(dir).catch(() => [] as string[]))
      .filter((f) => f.endsWith(`-${profile}.json`))
      .map((f) => path.join(dir, f))
      .filter((f) => f !== except)
      .sort();
    return files.at(-1);
  }
}
