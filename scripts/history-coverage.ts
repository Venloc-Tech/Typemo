/*
 * Coverage of `research/mongoose/M11-history/history.yaml` by the tests.
 * Every entry with `still_relevant: true` is looked up in the test sources of every package:
 *   - "title"   — its id (`H029`) is in the title of a `test(...)`/`describe(...)`;
 *   - "comment" — its id is only in a comment or a string of a test file (a covering test that names the entry
 *                 elsewhere; counted as covered, listed apart);
 *   - uncovered — nowhere in the tests. The reason comes from `packages/typemo/test/regressions/HISTORY-NOTES.md`
 *                 (`- Hnnn: reason` lines, written by hand), else "no reason recorded".
 * High risk (tags `security`, or data loss words in the problem) uncovered entries are listed first.
 *
 * Usage: `bun scripts/history-coverage.ts [--table]` (markdown summary; `--table` adds the full table).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

/** The repository root. */
const ROOT = resolve(import.meta.dir, "..");
/** The history file. */
const HISTORY = resolve(ROOT, "research/mongoose/M11-history/history.yaml");
/** The hand-written reasons for uncovered entries. */
const NOTES = resolve(ROOT, "packages/typemo/test/regressions/HISTORY-NOTES.md");

/**
 * One entry of the history file.
 *
 * @example
 * ```ts
 * const entry: Entry = { id: "H029", area: "schema", tags: [], problem: "…", relevant: true };
 * ```
 */
interface Entry {
  /** The entry id, `H` and digits. */
  readonly id: string;
  /** The area of the library. */
  readonly area: string;
  /** Tags such as `security`. */
  readonly tags: readonly string[];
  /** The problem description. */
  readonly problem: string;
  /** Whether the problem still applies. */
  readonly relevant: boolean;
}

/**
 * How an entry is covered by the tests.
 *
 * @example
 * ```ts
 * const coverage: Coverage = "title";
 * ```
 */
type Coverage = "title" | "comment" | "none";

/** Words that mark a high-risk problem (data loss, injection, leaks). */
const RISK = /(теря|потер|удал|затир|перезаписыва|silently|тихо|молча|data loss|injection|инъекц|CVE|утечк|чуж)/i;

/** Computes and prints the coverage. */
class HistoryCoverage {
  /**
   * The entries of history.yaml (a flat list of maps: read line by line, no YAML dependency).
   *
   * @returns The entries.
   */
  static entries(): Entry[] {
    const out: Entry[] = [];
    let current: { id?: string; area?: string; tags?: string[]; problem?: string; relevant?: boolean } | undefined;
    const flush = () => {
      if (current?.id !== undefined) {
        out.push({
          id: current.id,
          area: current.area ?? "",
          tags: current.tags ?? [],
          problem: current.problem ?? "",
          relevant: current.relevant === true,
        });
      }
    };
    for (const line of readFileSync(HISTORY, "utf8").split("\n")) {
      const id = /^- id:\s*(H\d+)/.exec(line)?.[1];
      if (id !== undefined) {
        flush();
        current = { id };
        continue;
      }
      if (current === undefined) continue;
      const field = /^\s+(area|tags|problem|still_relevant):\s*(.*)$/.exec(line);
      if (field === null) continue;
      const [, key, value = ""] = field;
      if (key === "area") current.area = value.trim();
      if (key === "tags")
        current.tags = value
          .replace(/[[\]]/g, "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean);
      if (key === "problem") current.problem = value.replace(/^"|"$/g, "");
      if (key === "still_relevant") current.relevant = value.trim() === "true";
    }
    flush();
    return out;
  }

  /**
   * Hand-written reasons for uncovered entries: `H123: reason` lines.
   *
   * @returns The reasons by entry id.
   */
  static notes(): ReadonlyMap<string, string> {
    const notes = new Map<string, string>();
    if (!existsSync(NOTES)) return notes;
    for (const line of readFileSync(NOTES, "utf8").split("\n")) {
      const match = /^-?\s*(H\d+):\s*(.+)$/.exec(line.trim());
      if (match !== null) notes.set(match[1] as string, (match[2] as string).replace(/^"|"$/g, ""));
    }
    return notes;
  }

  /**
   * Every TypeScript file below a directory, skipping `node_modules` and `dist`.
   *
   * @param dir - The directory.
   * @returns Absolute paths.
   */
  static walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      if (name === "node_modules" || name === "dist") return [];
      const path = join(dir, name);
      return statSync(path).isDirectory() ? HistoryCoverage.walk(path) : name.endsWith(".ts") ? [path] : [];
    });
  }

  /**
   * Where each id is named: in test titles, elsewhere in test files.
   *
   * @returns The files by id, for titles and for other mentions.
   */
  static scan(): { titles: Map<string, Set<string>>; mentions: Map<string, Set<string>> } {
    const titles = new Map<string, Set<string>>();
    const mentions = new Map<string, Set<string>>();
    const add = (map: Map<string, Set<string>>, id: string, where: string) => {
      const set = map.get(id) ?? new Set<string>();
      set.add(where);
      map.set(id, set);
    };
    const packages = join(ROOT, "packages");
    for (const pkg of readdirSync(packages)) {
      const dir = join(packages, pkg, "test");
      if (!existsSync(dir)) continue;
      for (const file of HistoryCoverage.walk(dir)) {
        const text = readFileSync(file, "utf8");
        const where = relative(ROOT, file);
        for (const match of text.matchAll(/\bH\d{3}\b/g)) add(mentions, match[0], where);
        const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
        const visit = (node: ts.Node): void => {
          if (ts.isCallExpression(node)) {
            const callee = node.expression;
            const name = ts.isIdentifier(callee)
              ? callee.text
              : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
                ? callee.expression.text
                : "";
            const [first] = node.arguments;
            if (
              (name === "test" || name === "it" || name === "describe") &&
              first !== undefined &&
              (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))
            ) {
              for (const match of first.text.matchAll(/\bH\d{3}\b/g)) add(titles, match[0], where);
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
    }
    return { titles, mentions };
  }

  /**
   * Prints the coverage summary.
   *
   * @param withTable - Also print the full table.
   */
  static run(withTable: boolean): void {
    const entries = HistoryCoverage.entries().filter((entry) => entry.relevant);
    const notes = HistoryCoverage.notes();
    const { titles, mentions } = HistoryCoverage.scan();
    const rows = entries.map((entry) => {
      const coverage: Coverage = titles.has(entry.id) ? "title" : mentions.has(entry.id) ? "comment" : "none";
      const files = [...(titles.get(entry.id) ?? mentions.get(entry.id) ?? [])];
      const risk = entry.tags.includes("security") || RISK.test(entry.problem);
      return { entry, coverage, files, risk, note: notes.get(entry.id) };
    });
    const count = (coverage: Coverage) => rows.filter((row) => row.coverage === coverage).length;
    const covered = count("title") + count("comment");
    const pct = (n: number) => `${((100 * n) / rows.length).toFixed(1)}%`;
    const out: string[] = [
      `Записей с \`still_relevant: true\`: **${rows.length}**.`,
      "",
      "| Покрытие | Записей | Доля |",
      "|---|---|---|",
      `| тест с \`Hnnn\` в названии | ${count("title")} | ${pct(count("title"))} |`,
      `| \`Hnnn\` только в комментарии/строке тест-файла | ${count("comment")} | ${pct(count("comment"))} |`,
      `| **покрыто всего** | **${covered}** | **${pct(covered)}** |`,
      `| не покрыто | ${count("none")} | ${pct(count("none"))} |`,
      `| — из них с записанной причиной | ${rows.filter((row) => row.coverage === "none" && row.note !== undefined).length} | |`,
      ...(["n/a", "поведение", "нет теста"] as const).map((kind) => {
        const n = rows.filter((row) => row.coverage === "none" && row.note?.startsWith(kind)).length;
        return `| — ${kind} | ${n} | ${pct(n)} |`;
      }),
      "",
    ];
    const areas = new Map<string, { total: number; covered: number }>();
    for (const row of rows) {
      const area = areas.get(row.entry.area) ?? { total: 0, covered: 0 };
      area.total += 1;
      if (row.coverage !== "none") area.covered += 1;
      areas.set(row.entry.area, area);
    }
    out.push("| area | всего | покрыто | доля |", "|---|---|---|---|");
    for (const [area, value] of [...areas].sort(([a], [b]) => a.localeCompare(b))) {
      out.push(
        `| ${area} | ${value.total} | ${value.covered} | ${((100 * value.covered) / value.total).toFixed(0)}% |`,
      );
    }
    const risky = rows.filter((row) => row.coverage === "none" && row.risk);
    out.push("", `Не покрыты и с высоким риском (security / потеря данных): ${risky.length}.`);
    for (const row of risky) out.push(`- ${row.entry.id} (${row.entry.area}): ${row.note ?? "причина не записана"}`);
    if (withTable) {
      out.push("", "| id | area | покрытие | где / причина |", "|---|---|---|---|");
      for (const row of rows) {
        const where = row.coverage === "none" ? (row.note ?? "причина не записана") : row.files.slice(0, 2).join(", ");
        out.push(`| ${row.entry.id} | ${row.entry.area} | ${row.coverage} | ${where.replace(/\|/g, "\\|")} |`);
      }
    }
    console.log(out.join("\n"));
  }
}

HistoryCoverage.run(process.argv.includes("--table"));
