import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

/*
 * The integrity of the tests themselves, for every package.
 * 1. A test that does not run — `test.todo/skip/only/failing` (also `it.*`, `describe.*`, `*.skipIf/todoIf/if`) —
 *    must say in its TITLE which open decision it waits for: `… (open decision L5)`. The id must exist in
 *    research/DECISIONS.md or on the question board (research/_board/questions.md). Several `todo`s once waited for
 *    a decision that had been taken long before; this guard makes such a test visible.
 * 2. Every `as unknown as` / `as any` in a test must give its reason in a comment on the same line or on the line
 *    before it (a mock, a deliberate bypass of the type to test a runtime guard, …). A cast without a reason is how
 *    a gap in the types hides.
 * The scan reads the syntax tree (strings and regular expressions that merely CONTAIN these words do not count).
 */

const ROOT = resolve(import.meta.dir, "../../../..");
/** The workspace groups: the packages and the integrations. */
const GROUPS = [join(ROOT, "packages"), join(ROOT, "integrations")];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "dist") return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : [];
  });

/** Every test source: `<group>/<pkg>/test/**` plus `*.test.ts` next to the sources. */
const testFiles = (): string[] =>
  GROUPS.flatMap((group) => readdirSync(group).map((pkg) => join(group, pkg))).flatMap((base) => {
    const tests = existsSync(join(base, "test")) ? walk(join(base, "test")) : [];
    const colocated = existsSync(join(base, "src"))
      ? walk(join(base, "src")).filter((f) => f.endsWith(".test.ts"))
      : [];
    return [...tests, ...colocated];
  });

const NOT_RUNNING = new Set(["todo", "skip", "only", "failing", "skipIf", "todoIf", "if"]);
const RUNNERS = new Set(["test", "it", "describe"]);
/** `(open decision L5)`, `open decision Q-PLAN-4`, `open decision Q10-2`. */
const OPEN_REFERENCE = /\bopen decision ((?:Q-)?[A-Z]{1,4}\d*(?:-[A-Z0-9]+)*)\b/;

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly problem: string;
}

/** The checks over one source text (exported for the self-test below). */
export class TestIntegrity {
  /** Decision ids known in the decision log and on the question board. */
  static knownIds(): ReadonlySet<string> {
    const texts = ["research/DECISIONS.md", "research/_board/questions.md"]
      .map((path) => join(ROOT, path))
      .filter((path) => existsSync(path))
      .map((path) => readFileSync(path, "utf8"));
    const ids = new Set<string>();
    for (const text of texts) {
      for (const match of text.matchAll(/\b(?:Q-[A-Z0-9-]+|Q\d+-\d+|[A-Z]{1,2}\d{1,3})\b/g)) ids.add(match[0]);
    }
    return ids;
  }

  static check(file: string, text: string, known: ReadonlySet<string>): Finding[] {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const lines = text.split("\n");
    const findings: Finding[] = [];
    const lineOf = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line;
    const commented = (line: number): boolean => {
      const own = lines[line] ?? "";
      const previous = (lines[line - 1] ?? "").trim();
      return /\/\/|\/\*/.test(own) || previous.startsWith("//") || previous.endsWith("*/") || previous.startsWith("*");
    };
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const { expression: owner, name } = node.expression;
        if (ts.isIdentifier(owner) && RUNNERS.has(owner.text) && NOT_RUNNING.has(name.text)) {
          const [first] = node.arguments;
          const title =
            first !== undefined && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))
              ? first.text
              : "";
          const reference = OPEN_REFERENCE.exec(title)?.[1];
          if (reference === undefined || !known.has(reference)) {
            findings.push({
              file,
              line: lineOf(node) + 1,
              problem: `${owner.text}.${name.text} without "open decision <id>" of a known decision in its title`,
            });
          }
        }
      }
      if (ts.isAsExpression(node)) {
        const anyCast = node.type.kind === ts.SyntaxKind.AnyKeyword;
        const unknownCast =
          ts.isAsExpression(node.expression) && node.expression.type.kind === ts.SyntaxKind.UnknownKeyword;
        if ((anyCast || unknownCast) && !commented(lineOf(node.type))) {
          findings.push({
            file,
            line: lineOf(node.type) + 1,
            problem: `${anyCast ? "as any" : "as unknown as"} without a reason comment (same line or the line before)`,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return findings;
  }
}

describe("guards: test integrity", () => {
  test("self-check: the rules catch what they must and accept what they may", () => {
    const known = new Set(["L5"]);
    const bad = [
      'test.todo("waits for a decision", () => {});',
      'test.skip("skipped (open decision Z99)", () => {});',
      "const a = value as unknown as string;",
      "const b = value as any;",
    ].join("\n");
    expect(TestIntegrity.check("bad.ts", bad, known).map((finding) => finding.line)).toEqual([1, 2, 3, 4]);
    const good = [
      'test.todo("waits (open decision L5)", () => {});',
      "// a mock of the driver's session",
      "const a = value as unknown as string;",
      "const b = value as any; // a runtime matrix beyond the types",
      'const text = "as unknown as"; const re = /as any/;',
    ].join("\n");
    expect(TestIntegrity.check("good.ts", good, known)).toEqual([]);
  });

  test("every test source of every package follows both rules", () => {
    const known = TestIntegrity.knownIds();
    const findings = testFiles().flatMap((file) =>
      TestIntegrity.check(relative(ROOT, file), readFileSync(file, "utf8"), known),
    );
    expect(findings).toEqual([]);
  });
});
