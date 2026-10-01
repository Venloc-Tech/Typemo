import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { PublicTsdoc } from "@venloc/typemo-test-kit";
import ts from "typescript";

/*
 * Decision, plan and research ids (`R47`, `D8`, `E4`, `Q-PLAN-1`, `H123`) are internal bookkeeping: a user reading
 * an error message or a type-level diagnostic cannot look them up. Every string and template literal of the shipped
 * sources (`packages/<name>/src`, `integrations/<name>/src`) is scanned; public references such as
 * `Mongoose gh-12345` or `CVE-2025-23061` stay allowed. The TSDoc of the public API (what the IDE shows on hover)
 * is scanned too, with the research catalogue ids in any form (`Mongoose H6`, `(H17, …)`) and notes to ourselves
 * ("open question"); comments inside the code may keep them.
 */

const ROOT = resolve(import.meta.dir, "../../../..");
const SOURCE_GLOBS = ["packages/*/src/**/*.ts", "integrations/*/src/**/*.ts"] as const;

/** One literal that carries an internal id. */
interface Hit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/** Scanner of the literals of a source file for internal decision, plan and research ids. */
class DecisionIdScanner {
  /** Internal id shapes; each needs a delimiter a sentence would not produce by chance. */
  static readonly PATTERNS: readonly RegExp[] = [
    /* `(R47)`, `(D8)`, `(E4)`, `(P5)`, `(H123)` */
    /\((?:[DREPH]\d{1,3})\)/,
    /* `…, E4)`, `…, D8)` at the end of a parenthesis */
    /,\s*[DREPH]\d{1,3}\)/,
    /* `decision P5`, `plan E4`, `research H029` */
    /\b(?:decision|decisions|plan|research|stage)\s+[DREPHQ]-?\d{1,3}\b/i,
    /* `Q-PLAN-1`, `Q-TYPES-12` */
    /\bQ-[A-Z]+-\d+\b/,
    /* Research catalogue ids `H029`, `H123` */
    /\bH\d{3}\b/,
    /*
     * A bare `R47` is not matched: `R5`…`R80` are the Renard series of `$bucketAuto` granularity, a public
     * MongoDB value.
     */
  ];

  /**
   * The literals of one file that match an internal id pattern.
   *
   * @param file - Path relative to the repository root.
   * @param text - The file contents.
   * @returns The offending literals.
   */
  static scan(file: string, text: string): Hit[] {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const hits: Hit[] = [];
    const visit = (node: ts.Node): void => {
      if (DecisionIdScanner.isLiteral(node) && DecisionIdScanner.PATTERNS.some((pattern) => pattern.test(node.text))) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        hits.push({ file, line: line + 1, text: node.text });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return hits;
  }

  /**
   * Whether the node is a string literal or a piece of a template literal (value or type position).
   *
   * @param node - Any AST node.
   * @returns `true` for literals whose text reaches a user.
   */
  static isLiteral(
    node: ts.Node,
  ): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateLiteralLikeNode {
    return (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    );
  }
}

/** Shapes that are internal in the public TSDoc, on top of {@link DecisionIdScanner.PATTERNS}. */
const TSDOC_PATTERNS: readonly RegExp[] = [
  ...DecisionIdScanner.PATTERNS,
  /* A research catalogue id in any form: `Mongoose H6`, `(H17, …)`, `history H015`. */
  /\bH\d{1,3}\b/,
  /* A note to ourselves. */
  /\bopen question\b/i,
];

const sourceFiles = (): string[] =>
  SOURCE_GLOBS.flatMap((pattern) => [...new Bun.Glob(pattern).scanSync({ cwd: ROOT })]).sort();

describe("guards: no decision, plan or research ids in the literals of shipped sources", () => {
  test("every string and template literal under packages/*/src and integrations/*/src is free of internal ids", async () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(100);
    const hits: Hit[] = [];
    for (const file of files) hits.push(...DecisionIdScanner.scan(file, await Bun.file(resolve(ROOT, file)).text()));
    expect(hits.map((hit) => `${hit.file}:${hit.line}: ${hit.text}`)).toEqual([]);
  });

  test("the public TSDoc (entry points, their members) is free of internal ids and notes", () => {
    const { comments } = PublicTsdoc.collect();
    expect(comments.length).toBeGreaterThan(500);
    const hits: string[] = [];
    for (const comment of comments) {
      const { text, line } = PublicTsdoc.textOf(comment);
      text.split("\n").forEach((row, index) => {
        if (TSDOC_PATTERNS.some((pattern) => pattern.test(row))) {
          hits.push(`${comment.file}:${line + index} (${comment.owner}): ${row.trim()}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  test("the patterns catch the known shapes and let public references through", () => {
    const flagged = [
      "the two packages cannot be mixed (R47)",
      "#private fields cannot be schema members, E4)",
      "strict by default (D8)",
      "see decision P5",
      "open question Q-PLAN-1",
      "research H123",
      "the name is refused, D9)",
    ];
    for (const text of flagged) {
      expect(DecisionIdScanner.scan("probe.ts", `const s = ${JSON.stringify(text)};`)).toHaveLength(1);
    }
    expect(DecisionIdScanner.scan("probe.ts", ["type T = `@Prop $", "{string}: bad (E4)`;"].join(""))).toHaveLength(1);
    const allowed = [
      "not supported (Mongoose gh-12345)",
      "runs JavaScript on the server (Mongoose CVE-2025-23061)",
      "a Decimal128 value",
      "an int32 or a double",
    ];
    for (const text of allowed) {
      expect(DecisionIdScanner.scan("probe.ts", `const s = ${JSON.stringify(text)};`)).toEqual([]);
    }
    for (const text of ["(Mongoose H6)", "fields (H17, `Plus`)", "Open question: the default may change"]) {
      expect(TSDOC_PATTERNS.some((pattern) => pattern.test(text))).toBe(true);
    }
    expect(TSDOC_PATTERNS.some((pattern) => pattern.test('const granularity: BucketGranularity = "R20";'))).toBe(false);
  });
});
