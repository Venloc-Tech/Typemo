import type { ContestantId, RunResult } from "../harness/types.ts";

/**
 * One median that changed beyond the threshold.
 *
 * @example
 * ```ts
 * const worst: Regression | undefined = report.regressions[0];
 * ```
 */
export interface Regression {
  /** Scenario id. */
  readonly scenario: string;
  /** Dataset size. */
  readonly size: string;
  /** Who slowed down or sped up. */
  readonly contestant: ContestantId;
  /** Baseline median, ms. */
  readonly baselineMs: number;
  /** Current median, ms. */
  readonly currentMs: number;
  /** current / baseline − 1 */
  readonly change: number;
}

/**
 * The comparison of a run with a baseline.
 *
 * @example
 * ```ts
 * const report: RegressionReport = RegressionComparator.compare(baseline, current);
 * ```
 */
export interface RegressionReport {
  /** The relative change that counts. */
  readonly threshold: number;
  /** How many medians were compared. */
  readonly compared: number;
  /** Medians that got slower than the threshold. */
  readonly regressions: readonly Regression[];
  /** Medians that got faster than the threshold. */
  readonly improvements: readonly Regression[];
}

/** A regression is a slowdown of more than 10 % (median) against a baseline result file. */
export class RegressionComparator {
  /** The default threshold, as a fraction. */
  static readonly THRESHOLD = 0.1;

  /**
   * Compares the medians of two runs.
   *
   * @param baseline - The reference run.
   * @param current - The run under test.
   * @param threshold - The relative change that counts.
   * @returns The regressions and improvements.
   */
  static compare(
    baseline: RunResult,
    current: RunResult,
    threshold: number = RegressionComparator.THRESHOLD,
  ): RegressionReport {
    const base = new Map<string, number>();
    for (const s of baseline.scenarios) {
      for (const c of s.contestants) {
        if (c.status === "ok" && c.time !== undefined) base.set(`${s.id}|${s.size}|${c.contestant}`, c.time.median);
      }
    }
    const regressions: Regression[] = [];
    const improvements: Regression[] = [];
    let compared = 0;
    for (const s of current.scenarios) {
      for (const c of s.contestants) {
        if (c.status !== "ok" || c.time === undefined) continue;
        const before = base.get(`${s.id}|${s.size}|${c.contestant}`);
        if (before === undefined || before <= 0) continue;
        compared++;
        const change = c.time.median / before - 1;
        const row = {
          scenario: s.id,
          size: s.size,
          contestant: c.contestant,
          baselineMs: before,
          currentMs: c.time.median,
          change,
        };
        if (change > threshold) regressions.push(row);
        else if (change < -threshold) improvements.push(row);
      }
    }
    regressions.sort((a, b) => b.change - a.change);
    improvements.sort((a, b) => a.change - b.change);
    return { threshold, compared, regressions, improvements };
  }

  /**
   * A readable summary of a comparison.
   *
   * @param report - The comparison.
   * @returns The text.
   */
  static format(report: RegressionReport): string {
    const pct = (x: number): string => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
    const lines = [
      `Compared ${report.compared} medians, threshold ${pct(report.threshold)}: ` +
        `${report.regressions.length} regressions, ${report.improvements.length} improvements.`,
    ];
    for (const r of report.regressions) {
      lines.push(
        `  REGRESSION ${r.scenario} (${r.size}) ${r.contestant}: ${r.baselineMs.toFixed(3)} → ${r.currentMs.toFixed(3)} ms (${pct(r.change)})`,
      );
    }
    return lines.join("\n");
  }
}
