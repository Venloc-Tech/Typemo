// Proves that a comment-only change did not touch the code: every changed TypeScript file of the working tree is
// compared with its `HEAD` version after both are parsed and re-printed WITHOUT comments. The titles of
// `describe` / `test` / `it` calls are ignored too (they may be reworded), nothing else is.
// Usage: `bun scripts/code-unchanged.ts` — prints the files whose code differs and exits with 1 when there are any.
import ts from "typescript";

const TITLED_CALLS = new Set(["describe", "test", "it"]);

/** The name of a call such as `test(...)`, `test.skip(...)` or `describe.each(...)(...)`: its root identifier. */
const callRoot = (expression: ts.Expression): string | undefined => {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return callRoot(expression.expression);
  if (ts.isCallExpression(expression)) return callRoot(expression.expression);
  return undefined;
};

/** Replaces the title (first argument) of test-runner calls by a placeholder, so rewording a title is not a change. */
const withoutTitles = (context: ts.TransformationContext) => (root: ts.SourceFile) => {
  const visit = (node: ts.Node): ts.Node => {
    if (ts.isCallExpression(node)) {
      const name = callRoot(node.expression);
      const first = node.arguments[0];
      if (name !== undefined && TITLED_CALLS.has(name) && first !== undefined && ts.isStringLiteralLike(first)) {
        const args = [ts.factory.createStringLiteral("<title>"), ...node.arguments.slice(1)];
        return ts.visitEachChild(
          ts.factory.updateCallExpression(node, node.expression, node.typeArguments, args),
          visit,
          context,
        );
      }
    }
    return ts.visitEachChild(node, visit, context);
  };
  return ts.visitNode(root, visit) as ts.SourceFile;
};

/** The code of a file: parsed, test titles neutralized, printed without comments. */
const codeOf = (fileName: string, text: string): string => {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const [transformed] = ts.transform(source, [withoutTitles]).transformed;
  return ts.createPrinter({ removeComments: true }).printFile(transformed as ts.SourceFile);
};

const run = async (): Promise<number> => {
  const changed = (await Bun.$`git diff --name-only HEAD -- '*.ts'`.text()).split("\n").filter(Boolean);
  const differing: string[] = [];
  for (const file of changed) {
    const current = Bun.file(file);
    if (!(await current.exists())) continue;
    const before = await Bun.$`git show HEAD:${file}`.nothrow().quiet();
    if (before.exitCode !== 0) continue;
    if (codeOf(file, before.stdout.toString()) !== codeOf(file, await current.text())) differing.push(file);
  }
  console.log(`checked ${changed.length} changed .ts files; code differs in ${differing.length}`);
  for (const file of differing) console.log(`  code changed: ${file}`);
  return differing.length === 0 ? 0 : 1;
};

process.exit(await run());
