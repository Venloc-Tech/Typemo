/*
 * Renders the result tables of groups I–R from a result JSON, for the benchmark report of those groups.
 * Time tables use `MarkdownReport.groupTable` (the same columns, units, ratio directions and verdicts as
 * the main report); the self-timed groups (O load, P streams, R compiler) get metric tables with explicit
 * units, ratio directions and a verdict per row.
 *
 * Usage (from packages/bench):
 *   bun run src/scenarios/support-bb/bb-report.ts results/<file>.json > tables.md
 */

import type { ContestantId, ScenarioResult } from "../../harness/types.ts";
import { MarkdownReport } from "../../report/markdown-report.ts";
import { ResultStore } from "../../report/result-store.ts";

/** Report headings of groups I–R. */
const GROUP_TITLES: Readonly<Record<string, string>> = {
  I: "I — populate",
  J: "J — агрегации",
  K: "K — транзакции",
  L: "L — механизмы",
  M: "M — коллекции в памяти (без сервера)",
  N: "N — приведение и валидация (без сервера)",
  O: "O — нагрузка YCSB",
  P: "P — change streams",
  Q: "Q — длительный прогон",
  R: "R — компилятор и IDE",
};

/** Renders the tables of groups I–R. */
class BbReport {
  /**
   * A self-measured metric of a contestant.
   *
   * @param s - The scenario result.
   * @param c - The contestant.
   * @param key - The metric name.
   * @returns The value, or `undefined` when the contestant has no such metric.
   */
  static metric(s: ScenarioResult, c: ContestantId, key: string): number | undefined {
    return s.contestants.find((x) => x.contestant === c)?.outcome?.metrics?.[key];
  }

  /**
   * Formats a number for a table.
   *
   * @param value - The number.
   * @param digits - Decimals below 100.
   * @returns The text, or a dash for a missing value.
   */
  static fmt(value: number | undefined, digits = 2): string {
    return value === undefined || !Number.isFinite(value)
      ? "—"
      : value >= 100
        ? value.toFixed(0)
        : value.toFixed(digits);
  }

  /**
   * A sentence like "Typemo в 1.5× выше пропускная способность …" for a higher-is-better metric.
   *
   * @param t - Typemo's value.
   * @param m - Mongoose's value.
   * @param unit - The unit shown in the sentence.
   * @returns The sentence, or a dash when a value is missing.
   */
  static throughputVerdict(t: number | undefined, m: number | undefined, unit: string): string {
    if (t === undefined || m === undefined) return "—";
    const r = t / m;
    const pair = `(${BbReport.fmt(t)} против ${BbReport.fmt(m)} ${unit})`;
    if (Math.abs(r - 1) < 0.05) return `Typemo на уровне Mongoose (±5 %) ${pair}`;
    return r > 1
      ? `Typemo в ${r.toFixed(2)}× выше пропускная способность, чем у Mongoose ${pair}`
      : `Typemo в ${(1 / r).toFixed(2)}× ниже пропускная способность, чем у Mongoose ${pair}`;
  }

  /**
   * The load table (group O).
   *
   * @param scenarios - The load results.
   * @returns The Markdown lines.
   */
  static load(scenarios: readonly ScenarioResult[]): string[] {
    const order: ContestantId[] = ["driver", "mongoose", "mongoose-safe", "typemo", "typemo-lean"];
    const lines = [
      "| Сценарий | ops/s: driver / mongoose / m-safe / typemo / t-lean | p50, мс: d / m / ms / t / tl | p99, мс: d / m / ms / t / tl | Typemo ÷ Mongoose по ops/s (×, >1 = Typemo быстрее) | t-lean ÷ driver по ops/s (×, >1 = lean быстрее) | Вывод |",
      "|---|---|---|---|---:|---:|---|",
    ];
    for (const s of scenarios) {
      const col = (key: string, digits: number) =>
        order.map((c) => BbReport.fmt(BbReport.metric(s, c, key), digits)).join(" / ");
      const t = BbReport.metric(s, "typemo", "opsPerSec");
      const m = BbReport.metric(s, "mongoose", "opsPerSec");
      const tl = BbReport.metric(s, "typemo-lean", "opsPerSec");
      const d = BbReport.metric(s, "driver", "opsPerSec");
      lines.push(
        `| \`${s.id}\` ${s.title} | ${col("opsPerSec", 0)} | ${col("p50Ms", 2)} | ${col("p99Ms", 2)} | ` +
          `${t !== undefined && m !== undefined ? `×${(t / m).toFixed(2)}` : "—"} | ` +
          `${tl !== undefined && d !== undefined ? `×${(tl / d).toFixed(2)}` : "—"} | ${BbReport.throughputVerdict(t, m, "ops/s")} |`,
      );
    }
    return lines;
  }

  /**
   * The change-stream throughput table (group P).
   *
   * @param scenarios - The stream results.
   * @returns The Markdown lines.
   */
  static streams(scenarios: readonly ScenarioResult[]): string[] {
    const lines = [
      "| Сценарий | событий/с (из медианы времени): driver / mongoose / typemo / t-lean | Typemo ÷ Mongoose по событиям/с (×, >1 = Typemo быстрее) | t-lean ÷ driver (×, >1 = lean быстрее) | Вывод |",
      "|---|---|---:|---:|---|",
    ];
    for (const s of scenarios) {
      /* From the MEDIAN time of the timed runs (the `eventsPerSec` metric is of the single verify run: noisy). */
      const e = (c: ContestantId): number | undefined => {
        const median = s.contestants.find((x) => x.contestant === c && x.status === "ok")?.time?.median;
        return median === undefined ? undefined : (s.unitsPerOp / median) * 1000;
      };
      const [d, m, t, tl] = [e("driver"), e("mongoose"), e("typemo"), e("typemo-lean")];
      lines.push(
        `| \`${s.id}\` ${s.title} (${s.size}) | ${[d, m, t, tl].map((x) => BbReport.fmt(x, 0)).join(" / ")} | ` +
          `${t !== undefined && m !== undefined ? `×${(t / m).toFixed(2)}` : "—"} | ` +
          `${tl !== undefined && d !== undefined ? `×${(tl / d).toFixed(2)}` : "—"} | ${BbReport.throughputVerdict(t, m, "событий/с")} |`,
      );
    }
    return lines;
  }

  /**
   * The compiler and hover table (group R).
   *
   * @param scenarios - The compiler results.
   * @returns The Markdown lines.
   */
  static compiler(scenarios: readonly ScenarioResult[]): string[] {
    const rows: [string, string, string][] = [
      ["tscTotalMs", "tsc всего, мс", "меньше — лучше"],
      ["checkMs", "Check time, мс", "меньше — лучше"],
      ["userCheckMs", "Check time кода приложения (проект − базовый), мс", "меньше — лучше"],
      ["instantiations", "Instantiations", "меньше — лучше"],
      ["userInstantiations", "Instantiations кода приложения", "меньше — лучше"],
      ["memoryMb", "Память tsc, МБ", "меньше — лучше"],
      ["baselineCheckMs", "Check time базового проекта (типы библиотеки), мс", "меньше — лучше"],
      ["hoverColdMs", "hover, первый (холодный), мс", "меньше — лучше"],
      ["hoverWarmMs", "hover, повторный, мс", "меньше — лучше"],
      ["hoverEditMs", "hover после правки, мс", "меньше — лучше"],
    ];
    const lines: string[] = [];
    for (const s of scenarios) {
      lines.push(
        `Проект ${s.size === "M" ? "20 моделей × 200 запросов" : s.size === "T" ? "3 × 10 (smoke)" : "5 моделей × 50 запросов"} (${s.unitsPerOp} запросов).`,
        "",
        "| Метрика | Mongoose | Typemo | Typemo ÷ Mongoose (×, >1 = Typemo тяжелее) | Вывод |",
        "|---|---:|---:|---:|---|",
      );
      for (const [key, label] of rows) {
        const m = BbReport.metric(s, "mongoose", key);
        const t = BbReport.metric(s, "typemo", key);
        const r = t !== undefined && m !== undefined && m !== 0 ? t / m : undefined;
        const verdict =
          r === undefined
            ? "—"
            : Math.abs(r - 1) < 0.05
              ? "на уровне (±5 %)"
              : r > 1
                ? `Typemo в ${r.toFixed(2)}× тяжелее (${BbReport.fmt(t)} против ${BbReport.fmt(m)}) — цена строгости`
                : `Typemo в ${(1 / r).toFixed(2)}× легче (${BbReport.fmt(t)} против ${BbReport.fmt(m)})`;
        lines.push(
          `| ${label} | ${BbReport.fmt(m, 1)} | ${BbReport.fmt(t, 1)} | ${r === undefined ? "—" : `×${r.toFixed(2)}`} | ${verdict} |`,
        );
      }
      lines.push("");
    }
    return lines;
  }

  /**
   * Every table, grouped.
   *
   * @param scenarios - The results of groups I–R.
   * @returns The Markdown text.
   */
  static render(scenarios: readonly ScenarioResult[]): string {
    const out: string[] = [];
    for (const group of Object.keys(GROUP_TITLES)) {
      const mine = scenarios.filter((s) => s.group === group);
      if (mine.length === 0) continue;
      out.push(`### ${GROUP_TITLES[group]}`, "");
      if (group === "O") out.push(...BbReport.load(mine));
      else if (group === "R") out.push(...BbReport.compiler(mine));
      else {
        out.push(...MarkdownReport.groupTable(mine));
        if (group === "P") out.push("", ...BbReport.streams(mine));
      }
      const failed = mine.filter((s) => s.status !== "ok");
      if (failed.length > 0)
        out.push("", ...failed.map((s) => `- **${s.id}: ${s.status}** — ${s.problems.join("; ")}`));
      out.push("");
    }
    return out.join("\n");
  }
}

/** The result file given on the command line. */
const file = process.argv[2];
if (file === undefined) throw new Error("usage: bb-report.ts <results.json>");
/** The loaded run. */
const run = await ResultStore.load(file);
console.log(BbReport.render(run.scenarios.filter((s) => "IJKLMNOPQR".includes(s.group))));
