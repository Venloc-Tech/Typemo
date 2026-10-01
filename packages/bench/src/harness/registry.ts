import path from "node:path";
import { Scenario } from "./scenario.ts";

/**
 * Discovers scenarios: every module in `src/scenarios/*.ts` (not tests, not `_`-prefixed helpers) that exports
 * `SCENARIOS: readonly Scenario[]`, so adding a scenario never edits a shared index file.
 */
export class ScenarioRegistry {
  /** The scenarios directory. */
  static readonly DIR = path.resolve(import.meta.dir, "../scenarios");

  /**
   * Loads every scenario of a directory.
   *
   * @param dir - The directory to scan; defaults to `src/scenarios`.
   * @returns The scenarios sorted by group and id.
   * @throws Error - When a module exports a non-`Scenario` or two scenarios share an id.
   */
  static async load(dir: string = ScenarioRegistry.DIR): Promise<Scenario[]> {
    const files = [...new Bun.Glob("*.ts").scanSync({ cwd: dir })]
      .filter((f) => !f.endsWith(".test.ts") && !f.startsWith("_"))
      .sort();
    const all: Scenario[] = [];
    const seen = new Map<string, string>();
    for (const file of files) {
      const mod = (await import(path.join(dir, file))) as { readonly SCENARIOS?: unknown };
      if (!Array.isArray(mod.SCENARIOS)) continue;
      for (const scenario of mod.SCENARIOS) {
        if (!(scenario instanceof Scenario)) throw new Error(`${file}: SCENARIOS contains a non-Scenario`);
        const clash = seen.get(scenario.id);
        if (clash !== undefined) throw new Error(`duplicate scenario id ${scenario.id} (${clash}, ${file})`);
        seen.set(scenario.id, file);
        all.push(scenario);
      }
    }
    return all.sort((a, b) => a.group.localeCompare(b.group) || a.id.localeCompare(b.id));
  }
}
