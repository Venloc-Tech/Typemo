/*
 * The report of the ported Mongoose tests: reads
 * `packages/typemo/test/ported/INDEX.md` and `from-mongoose-to-typemo/DIVERGENCES.md` and prints, as markdown:
 *   - the ported tests by area (pass / divergence / n/a / pending),
 *   - the groups of tests deferred to later (the "not ported yet" tables),
 *   - every inconsistency: a `divergence` without a DIVERGENCES.md number, a number that does not exist, a
 *     `pending` test (a pending status must be decided), a DIVERGENCES.md row out of the table format.
 * Exit code 1 when an inconsistency is found.
 *
 * Usage: `bun scripts/ported-report.ts`
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The repository root. */
const ROOT = resolve(import.meta.dir, "..");
/** The index of ported tests. */
const INDEX = resolve(ROOT, "packages/typemo/test/ported/INDEX.md");
/** The list of deliberate divergences. */
const DIVERGENCES = resolve(ROOT, "from-mongoose-to-typemo/DIVERGENCES.md");

/**
 * The kind of a port status.
 *
 * @example
 * ```ts
 * const kind: Status = PortedReport.kindOf("pass");
 * ```
 */
type Status = "pass" | "divergence" | "n/a" | "pending" | "other";

/**
 * One row of the index.
 *
 * @example
 * ```ts
 * const [row]: readonly Row[] = PortedReport.parse().ported;
 * ```
 */
interface Row {
  /** 1-based line in the index. */
  readonly line: number;
  /** The Mongoose test. */
  readonly source: string;
  /** The ported file. */
  readonly file: string;
  /** The status text. */
  readonly status: string;
  /** The status kind. */
  readonly kind: Status;
  /** The area of the library. */
  readonly area: string;
}

/** Builds the report of the ported tests. */
class PortedReport {
  /**
   * The DIVERGENCES.md numbers (first column) and the rows whose shape is wrong.
   *
   * @returns The ids and the malformed locations.
   */
  static divergences(): { readonly ids: ReadonlySet<string>; readonly malformed: readonly string[] } {
    const ids = new Set<string>();
    const malformed: string[] = [];
    readFileSync(DIVERGENCES, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (!line.startsWith("| L")) return;
        const cells = line.replace(/\\\|/g, "").split("|").slice(1, -1);
        const id = cells[0]?.trim() ?? "";
        if (cells.length !== 5 || !/^L\d[A-Z]?-\d+$/.test(id)) malformed.push(`DIVERGENCES.md:${index + 1}`);
        if (ids.has(id)) malformed.push(`DIVERGENCES.md:${index + 1} duplicate ${id}`);
        ids.add(id);
      });
    return { ids, malformed };
  }

  /**
   * The kind of a status text.
   *
   * @param status - The status cell.
   * @returns The kind.
   */
  static kindOf(status: string): Status {
    if (/^pass/.test(status)) return "pass";
    if (/^divergence/.test(status)) return "divergence";
    if (/^n\/a/.test(status)) return "n/a";
    if (/^pending/.test(status)) return "pending";
    return "other";
  }

  /** Sections whose rows have no file (a test that could not be ported) belong to the area of their section. */
  static readonly SECTION_AREAS: readonly (readonly [RegExp, string])[] = [
    [/^Реестр/, "bson"],
    [/5B/, "aggregate"],
    [/7B/, "collections"],
    [/7A/, "document"],
    [/Этап 8|populate/, "populate"],
    [/9A|9B/, "mechanisms"],
    [/6A|6B/, "model"],
    [/Этап 4/, "schema"],
  ];

  /**
   * The area of a row.
   *
   * @param file - The ported file.
   * @param section - The heading the row sits under.
   * @returns The area name.
   */
  static areaOf(file: string, section: string): string {
    const match = /packages\/typemo\/test\/[a-z]+\/([a-z-]+)\//.exec(file);
    if (match?.[1] !== undefined) return match[1];
    return PortedReport.SECTION_AREAS.find(([pattern]) => pattern.test(section))?.[1] ?? `(${section})`;
  }

  /**
   * The rows of the ported tables and the rows of the deferred tables.
   *
   * @returns Both row lists.
   */
  static parse(): { readonly ported: readonly Row[]; readonly deferred: readonly Row[] } {
    const ported: Row[] = [];
    const deferred: Row[] = [];
    let table: "ported" | "deferred" | undefined;
    let section = "";
    readFileSync(INDEX, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (line.startsWith("#")) section = line.replace(/^#+\s*/, "").slice(0, 60);
        if (!line.startsWith("|")) {
          table = undefined;
          return;
        }
        const cells = line
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim());
        if (/^Источник/.test(cells[0] ?? "")) {
          table = /Наш файл|Тест Typemo/.test(cells[1] ?? "") ? "ported" : "deferred";
          return;
        }
        if (/^-+$/.test((cells[0] ?? "").replace(/:/g, "")) || table === undefined) return;
        const [source = "", file = "", status = ""] = cells;
        const row: Row = {
          line: index + 1,
          source,
          file,
          status,
          kind: PortedReport.kindOf(status),
          area: PortedReport.areaOf(file, section),
        };
        (table === "ported" ? ported : deferred).push(row);
      });
    return { ported, deferred };
  }

  /**
   * Prints the report.
   *
   * @returns The process exit code: `1` when an inconsistency is found.
   */
  static run(): number {
    const { ids, malformed } = PortedReport.divergences();
    const { ported, deferred } = PortedReport.parse();
    const problems: string[] = [...malformed.map((where) => `${where}: not a row of the id-first table format`)];
    for (const row of ported) {
      if (row.kind === "divergence") {
        const refs = [...row.status.matchAll(/\bL\d[A-Z]?-\d+\b/g)].map((match) => match[0]);
        if (refs.length === 0) problems.push(`INDEX.md:${row.line}: divergence without a DIVERGENCES.md number`);
        for (const ref of refs)
          if (!ids.has(ref)) problems.push(`INDEX.md:${row.line}: ${ref} is not in DIVERGENCES.md`);
      }
      if (row.kind === "pending") problems.push(`INDEX.md:${row.line}: pending — decide it`);
      if (row.kind === "other") problems.push(`INDEX.md:${row.line}: unknown status "${row.status.slice(0, 40)}"`);
    }
    const areas = new Map<string, Record<Status, number>>();
    for (const row of ported) {
      const counts = areas.get(row.area) ?? { pass: 0, divergence: 0, "n/a": 0, pending: 0, other: 0 };
      counts[row.kind] += 1;
      areas.set(row.area, counts);
    }
    const total = { pass: 0, divergence: 0, "n/a": 0, pending: 0, other: 0 };
    const out: string[] = ["| Область | pass | divergence | n/a | pending | всего |", "|---|---|---|---|---|---|"];
    for (const [area, counts] of [...areas].sort(([a], [b]) => a.localeCompare(b))) {
      const sum = counts.pass + counts.divergence + counts["n/a"] + counts.pending + counts.other;
      for (const key of Object.keys(total) as Status[]) total[key] += counts[key];
      out.push(`| ${area} | ${counts.pass} | ${counts.divergence} | ${counts["n/a"]} | ${counts.pending} | ${sum} |`);
    }
    const all = total.pass + total.divergence + total["n/a"] + total.pending + total.other;
    out.push(
      `| **всего** | **${total.pass}** | **${total.divergence}** | **${total["n/a"]}** | **${total.pending}** | **${all}** |`,
    );
    out.push("", `Отложенных групп (таблицы «не перенесены сейчас»): ${deferred.length}.`);
    out.push(`Номеров в DIVERGENCES.md: ${ids.size}.`);
    out.push("", problems.length === 0 ? "Несоответствий нет." : `Несоответствия (${problems.length}):`);
    for (const problem of problems) out.push(`- ${problem}`);
    console.log(out.join("\n"));
    return problems.length === 0 ? 0 : 1;
  }
}

process.exit(PortedReport.run());
