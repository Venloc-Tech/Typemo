import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

/*
 * The schema layer works the same in a user project with `emitDecoratorMetadata` on or off and
 * `useDefineForClassFields` true or false. Bun takes the tsconfig of the cwd, so each configuration runs
 * the same script in its own folder.
 */

const CONFIGS = ["emit-off-define-off", "emit-on-define-off", "emit-off-define-on", "emit-on-define-on"] as const;
const FIXTURES = resolve(import.meta.dir, "../../fixtures/configs");

/** What the report script prints as JSON for one configuration. */
interface Report {
  readonly describe: unknown;
  readonly ownKeysAfterNew: readonly string[];
  readonly ownKeysAfterHydration: readonly string[];
  readonly getterWorks: string;
  readonly initializer: string;
  readonly metadataApi: string;
}

/**
 * Runs a fixture script with the tsconfig of one configuration folder.
 * @param config The configuration folder name.
 * @param script The script file name, one level above the folder.
 * @returns The captured stdout, stderr and exit code.
 */
const run = async (config: string, script: string): Promise<{ out: string; err: string; code: number }> => {
  const child = Bun.spawn(["bun", "run", `../${script}`], {
    cwd: resolve(FIXTURES, config),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { out, err, code };
};

describe("user tsconfig matrix: emitDecoratorMetadata × useDefineForClassFields", () => {
  const reports = new Map<string, Report>();

  for (const config of CONFIGS) {
    test(`${config}: the schema compiles, hydration and the initializer check work`, async () => {
      const { out, err, code } = await run(config, "report.ts");
      expect(err).toBe("");
      expect(code).toBe(0);
      const report = JSON.parse(out) as Report;
      reports.set(config, report);
      expect(report.ownKeysAfterHydration).toEqual([]);
      expect(report.getterWorks).toBe("Z");
      expect(report.initializer).toMatch(/field\(s\) "score" get a value from an initializer/);
      /* Typemo never needs the global reflect API, whatever the user's emit setting. */
      expect(report.metadataApi).toBe("undefined");
    }, 30_000);
  }

  test("all four configurations give the same compiled schema", () => {
    const [first, ...rest] = CONFIGS.map((config) => reports.get(config)?.describe);
    expect(first).toBeDefined();
    for (const other of rest) expect(other).toEqual(first);
  });

  test("define semantics leave own undefined fields after `new` (removed by hydration), legacy semantics do not", () => {
    expect(reports.get("emit-off-define-off")?.ownKeysAfterNew).toEqual([]);
    expect(reports.get("emit-off-define-on")?.ownKeysAfterNew.length).toBeGreaterThan(0);
  });

  test("documented limitation: with emitDecoratorMetadata a class used above its declaration is a TDZ error", async () => {
    const off = await run("emit-off-define-off", "tdz.ts");
    expect(off.code).toBe(0);
    expect(JSON.parse(off.out)).toEqual(["_id", "child", "child.name"]);
    const on = await run("emit-on-define-off", "tdz.ts");
    expect(on.code).not.toBe(0);
    expect(on.err).toMatch(/ReferenceError|Cannot access 'Child' before initialization/);
  }, 30_000);
});
