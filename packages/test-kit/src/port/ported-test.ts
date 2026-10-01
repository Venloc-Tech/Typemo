/**
 * Conventions for tests ported from Mongoose. Real ports live under `packages/typemo/test/ported/<area>/` and
 * are tracked in `packages/typemo/test/ported/INDEX.md`; this module only
 * standardizes the header comment/citation format so it's generated
 * consistently rather than free-handed per file, and can be unit-tested.
 *
 * Convention for a ported file:
 * 1. First line: `// ` + `PortedTest.header(...)`.
 * 2. Rewrite the test body against Typemo's / test-kit's syntax, but KEEP
 *    the original logic and assertions — do not "improve" it while porting.
 * 3. Add exactly one row to `packages/typemo/test/ported/INDEX.md`.
 * 4. If the test fails: do not adjust the expectation to match the actual
 *    result. Investigate, record the outcome (bug / deliberate divergence /
 *    server behavior differs / relied on legacy API) and report it —
 *    deliberate divergences additionally go in `from-mongoose-to-typemo/DIVERGENCES.md`.
 *
 * @example
 * ```ts
 * const source: PortedFrom = { file: "test/model.test.js", line: 12, title: "saves a document" };
 * ```
 */
export interface PortedFrom {
  /** Path relative to `references/mongoose-master/`, e.g. `test/model.test.js`. */
  readonly file: string;
  /** 1-based line number of the `it(...)` in the source file at port time. */
  readonly line: number;
  /** The original test title, verbatim. */
  readonly title: string;
  /** `history.yaml` entry id, when this test is tied to a known regression, e.g. `H029`. */
  readonly historyRef?: string;
}

/**
 * Outcome of a port, as recorded in the index.
 *
 * @example
 * ```ts
 * const status: PortedStatus = "divergence: Mongoose casts silently";
 * ```
 */
export type PortedStatus = "pass" | `divergence: ${string}` | "n/a: legacy";

/**
 * One row of the ported-tests index.
 *
 * @example
 * ```ts
 * const row: PortedIndexRow = { source, portedFile: "test/ported/model/save.test.ts", status: "pass" };
 * ```
 */
export interface PortedIndexRow {
  /** Where the test came from. */
  readonly source: PortedFrom;
  /** The ported test file. */
  readonly portedFile: string;
  /** The outcome. */
  readonly status: PortedStatus;
}

/** Formats the citation and index row of a ported test. */
export class PortedTest {
  /**
   * The exact text to put in the header comment, without the leading `// `.
   *
   * @param source - The origin of the test.
   * @returns The header text.
   */
  static header(source: PortedFrom): string {
    const historySuffix = source.historyRef ? ` (history: ${source.historyRef})` : "";
    return `ported from mongoose ${source.file}:${source.line} "${source.title}"${historySuffix}`;
  }

  /**
   * Renders one Markdown table row for `packages/typemo/test/ported/INDEX.md`.
   *
   * @param row - The index row data.
   * @returns The Markdown row.
   */
  static indexRow(row: PortedIndexRow): string {
    const sourceCell = `${row.source.file}:${row.source.line} "${row.source.title}"`;
    return `| ${sourceCell} | ${row.portedFile} | ${row.status} |`;
  }
}
