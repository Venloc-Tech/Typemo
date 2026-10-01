/**
 * Codemod: class members are methods, not arrow-function fields.
 *
 * Usage: bun run scripts/arrows-to-methods.ts [--dry] [glob ...]
 * Default globs: packages/*\/{src,test}/**\/*.ts, integrations/*\/{src,test}/**\/*.ts, scripts/**\/*.ts.
 *
 * Edits are applied as text splices by node position (bottom-up) so everything
 * outside the converted members keeps its formatting and comments.
 */
import { Glob } from "bun";
import ts from "typescript";

type Skip = { readonly file: string; readonly line: number; readonly name: string; readonly reason: string };
type Edit = { readonly start: number; readonly end: number; readonly text: string };
type Candidate = {
  readonly node: ts.PropertyDeclaration;
  readonly arrow: ts.ArrowFunction;
  readonly isStatic: boolean;
  readonly file: ts.SourceFile;
};

const ROOT = new URL("..", import.meta.url).pathname;
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const patterns = args.filter((a) => !a.startsWith("--"));
const globs =
  patterns.length > 0
    ? patterns
    : [
        "packages/*/src/**/*.ts",
        "packages/*/test/**/*.ts",
        "integrations/*/src/**/*.ts",
        "integrations/*/test/**/*.ts",
        "scripts/**/*.ts",
      ];

const collectFiles = (): readonly string[] => {
  const out = new Set<string>();
  for (const pattern of globs) {
    for (const f of new Glob(pattern).scanSync({ cwd: ROOT, absolute: true })) {
      if (!f.includes("/node_modules/") && !f.includes("/dist/") && !f.endsWith(".d.ts")) out.add(f);
    }
  }
  return [...out].sort();
};

const loadOptions = (): ts.CompilerOptions => {
  const configPath = `${ROOT}tsconfig.test.json`;
  const read = ts.readConfigFile(configPath, (p) => ts.sys.readFile(p));
  return ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT, undefined, configPath).options;
};

const usesThis = (node: ts.Node): boolean => {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (n.kind === ts.SyntaxKind.ThisKeyword || n.kind === ts.SyntaxKind.SuperKeyword) {
      found = true;
      return;
    }
    /* A nested non-arrow function or class has its own `this`. */
    if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassLike(n)) return;
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return found;
};

const lineOf = (file: ts.SourceFile, pos: number): number => file.getLineAndCharacterOfPosition(pos).line + 1;

const packageOf = (file: string): string => {
  const rel = file.slice(ROOT.length);
  const m = /^packages\/([^/]+)\//.exec(rel);
  return m?.[1] ?? rel.split("/")[0] ?? rel;
};

const buildReplacement = (c: Candidate): string => {
  const { node, arrow, file } = c;
  const text = file.text;
  const mods = (node.modifiers ?? [])
    .filter((m) => m.kind !== ts.SyntaxKind.ReadonlyKeyword)
    .map((m) => m.getText(file));
  const isAsync = (arrow.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
  if (isAsync) mods.push("async");
  const sigStart = (arrow.modifiers ?? []).reduce((p, m) => Math.max(p, m.end), arrow.getStart(file));
  let sig = text.slice(sigStart, arrow.equalsGreaterThanToken.getStart(file)).trim();
  if (!sig.startsWith("(") && !sig.startsWith("<")) sig = `(${sig})`;
  const bodyText = text.slice(arrow.equalsGreaterThanToken.end, arrow.end).trim();
  const returnsVoid = arrow.type?.kind === ts.SyntaxKind.VoidKeyword;
  const body = ts.isBlock(arrow.body) ? bodyText : returnsVoid ? `{\n ${bodyText};\n}` : `{\n return ${bodyText};\n}`;
  const head = mods.length > 0 ? `${mods.join(" ")} ` : "";
  return `${head}${node.name.getText(file)}${sig} ${body}`;
};

const main = (): void => {
  const files = collectFiles();
  const fileSet = new Set(files);
  const program = ts.createProgram({ rootNames: files, options: { ...loadOptions(), noEmit: true } });
  const checker = program.getTypeChecker();
  const skips: Skip[] = [];
  const candidates: Candidate[] = [];

  for (const file of program.getSourceFiles()) {
    if (!fileSet.has(file.fileName)) continue;
    const visit = (n: ts.Node): void => {
      if (
        ts.isPropertyDeclaration(n) &&
        n.initializer &&
        ts.isArrowFunction(n.initializer) &&
        ts.isClassLike(n.parent)
      ) {
        const name = n.name.getText(file);
        const isStatic = (n.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.StaticKeyword);
        const skip = (reason: string): void => {
          skips.push({ file: file.fileName.slice(ROOT.length), line: lineOf(file, n.getStart(file)), name, reason });
        };
        if (n.type) skip("explicit type annotation");
        else if (n.questionToken || n.exclamationToken) skip("optional/definite marker");
        else if ((n.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) skip("declare");
        else if (ts.isComputedPropertyName(n.name)) skip("computed name");
        else if (isStatic && usesThis(n.initializer)) skip("static arrow uses this");
        else candidates.push({ node: n, arrow: n.initializer, isStatic, file });
      }
      ts.forEachChild(n, visit);
    };
    visit(file);
  }

  /* Instance arrow fields: any reference that is not the callee of a call keeps them arrows. */
  const instance = candidates.filter((c) => !c.isStatic);
  const symbolToCandidate = new Map<ts.Symbol, Candidate>();
  const names = new Set<string>();
  for (const c of instance) {
    const sym = checker.getSymbolAtLocation(c.node.name);
    if (sym) {
      symbolToCandidate.set(sym, c);
      names.add(c.node.name.getText(c.file));
    }
  }
  const valueRefs = new Map<Candidate, string>();
  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile) continue;
    const visit = (n: ts.Node): void => {
      if ((ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) && names.has(n.text)) {
        const sym = checker.getSymbolAtLocation(n);
        const c = sym ? symbolToCandidate.get(sym) : undefined;
        if (c && n !== c.node.name) {
          const access = n.parent;
          const isCallee =
            (ts.isPropertyAccessExpression(access) || ts.isPropertyAccessChain(access)) &&
            access.name === n &&
            ts.isCallExpression(access.parent) &&
            access.parent.expression === access;
          if (!isCallee && !valueRefs.has(c)) {
            valueRefs.set(c, `${file.fileName.slice(ROOT.length)}:${lineOf(file, n.getStart(file))}`);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(file);
  }

  const converted = new Map<string, number>();
  const editsByFile = new Map<ts.SourceFile, Edit[]>();
  for (const c of candidates) {
    const where = valueRefs.get(c);
    if (where) {
      skips.push({
        file: c.file.fileName.slice(ROOT.length),
        line: lineOf(c.file, c.node.getStart(c.file)),
        name: c.node.name.getText(c.file),
        reason: `instance arrow used as a value (${where})`,
      });
      continue;
    }
    const list = editsByFile.get(c.file) ?? [];
    list.push({ start: c.node.getStart(c.file), end: c.node.end, text: buildReplacement(c) });
    editsByFile.set(c.file, list);
    const pkg = packageOf(c.file.fileName);
    converted.set(pkg, (converted.get(pkg) ?? 0) + 1);
  }

  const changed: string[] = [];
  for (const [file, edits] of editsByFile) {
    let text = file.text;
    for (const e of [...edits].sort((a, b) => b.start - a.start)) {
      text = text.slice(0, e.start) + e.text + text.slice(e.end);
    }
    if (!dry) ts.sys.writeFile(file.fileName, text);
    changed.push(file.fileName.slice(ROOT.length));
  }

  console.log("Converted per package:");
  for (const [pkg, n] of [...converted].sort()) console.log(`  ${pkg}: ${n}`);
  console.log(`Changed files (${changed.length}):`);
  for (const f of changed) console.log(`  ${f}`);
  console.log(`Skipped (${skips.length}):`);
  for (const s of skips) console.log(`  ${s.file}:${s.line} ${s.name} — ${s.reason}`);
};

main();
