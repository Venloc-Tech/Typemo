/*
 * Runs `tsc -b --extendedDiagnostics` for the whole workspace, extracts the
 * total compile time, and appends one row to from-mongoose-to-typemo/reports/tsc-timing.csv.
 * Used for the compiler budget: run after each layer, flag growth over 15% since the previous run.
 *
 * Usage: `bun scripts/typecheck-timing.ts [label]`
 */
import { resolve } from "node:path";

/** Measures and records the compile time of the workspace. */
class TscTimingRunner {
  /** The CSV file the rows are appended to. */
  static readonly reportPath = resolve(import.meta.dir, "../from-mongoose-to-typemo/reports/tsc-timing.csv");
  /** The CSV header. */
  static readonly header = "timestamp,label,total_time_seconds\n";

  /**
   * Builds the workspace from scratch and records the time.
   *
   * @param label - Names the row.
   * @throws Error - When `tsc -b` fails.
   */
  static async run(label: string): Promise<void> {
    const proc = Bun.spawn(["bunx", "tsc", "-b", "--force", "--extendedDiagnostics"], {
      cwd: resolve(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const output = stdout + stderr;
    console.log(output);
    if (exitCode !== 0) {
      throw new Error(`tsc -b failed with exit code ${exitCode}`);
    }
    const totalTime = TscTimingRunner.parseTotalTime(output);
    await TscTimingRunner.appendRow(label, totalTime);
    console.log(`typecheck-timing: total time ${totalTime}s (label: ${label})`);
  }

  /**
   * The total of the `Total time` lines.
   *
   * @param diagnosticsOutput - The output of `tsc --extendedDiagnostics`.
   * @returns Seconds.
   * @throws Error - When there is no `Total time` line.
   */
  static parseTotalTime(diagnosticsOutput: string): number {
    /* --extendedDiagnostics prints one "Total time:" line per project built.
       Sum them, since `tsc -b` builds every referenced project in one run. */
    const matches = [...diagnosticsOutput.matchAll(/Total time:\s*([\d.]+)s/g)];
    if (matches.length === 0) {
      throw new Error("Could not find a 'Total time:' line in tsc --extendedDiagnostics output");
    }
    return matches.reduce((sum, m) => sum + Number.parseFloat(m.at(1) ?? "0"), 0);
  }

  /**
   * Appends a row to the CSV, creating it with a header when missing.
   *
   * @param label - Names the row.
   * @param totalTimeSeconds - The compile time.
   */
  static async appendRow(label: string, totalTimeSeconds: number): Promise<void> {
    const file = Bun.file(TscTimingRunner.reportPath);
    const exists = await file.exists();
    const row = `${new Date().toISOString()},${label},${totalTimeSeconds.toFixed(3)}\n`;
    if (!exists) {
      await Bun.write(TscTimingRunner.reportPath, TscTimingRunner.header + row);
      return;
    }
    const previous = await file.text();
    await Bun.write(TscTimingRunner.reportPath, previous + row);
  }
}

/** The row label given on the command line. */
const label = process.argv[2] ?? "stage-0";
await TscTimingRunner.run(label);
