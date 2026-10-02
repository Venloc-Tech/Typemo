/*
 * Checks documentation pages (`.mdx`) the way the docs build will:
 *  - every ```ts twoslash block compiles against the working tree of the packages; the TypeScript errors it
 *    produces are exactly the codes listed in its `// @errors:` line (none when there is no such line);
 *  - `// ^?` queries print the type the reader will see (with `--types`);
 *  - the front matter has `title` and `description` (one sentence, at most 160 characters);
 *  - no `{` `}` `<` `>` in prose outside code and components (MDX would read them as JSX or expressions);
 *  - every relative link points to a file listed in DOCS-STRUCTURE.md (column "File") or that exists, and its
 *    `#anchor` exists in that file when the file is written (anchors as the build makes them from headings).
 * Usage: `bun scripts/docs-check.ts [--types] [--full] <file.mdx | dir> ...` — exits with 1 when a check fails;
 * `--full` prints compiler messages whole (they are cut at 240 characters otherwise).
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, relative, resolve } from "node:path";
import ts from "typescript";

const ROOT = resolve(import.meta.dir, "..");
const showTypes = process.argv.includes("--types");
const fullMessages = process.argv.includes("--full");
const targets = process.argv.slice(2).filter((a) => !a.startsWith("--"));

/** Compiler options of a docs example: the strictness the product recommends, legacy decorators. */
const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.Preserve,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  moduleDetection: ts.ModuleDetectionKind.Force,
  strict: true,
  exactOptionalPropertyTypes: true,
  noUncheckedIndexedAccess: true,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
  useDefineForClassFields: false,
  skipLibCheck: true,
  noEmit: true,
  allowImportingTsExtensions: true,
  types: ["bun"],
  typeRoots: [join(ROOT, "node_modules/@types")],
  paths: {
    "@venloc/typemo": [join(ROOT, "packages/typemo/src/index.ts")],
    "@venloc/typemo/testing": [join(ROOT, "packages/typemo/src/testing/index.ts")],
    "@venloc/typemo-decorators": [join(ROOT, "packages/decorators/src/index.ts")],
    mongodb: [join(ROOT, "packages/typemo/node_modules/mongodb")],
    "@venloc/typemo-nestjs": [join(ROOT, "integrations/nestjs/src/index.ts")],
    "@venloc/typemo-nestjs/testing": [join(ROOT, "integrations/nestjs/src/testing/index.ts")],
    // Nest itself is installed in the NestJS integration only; its pages compile against that copy.
    ...Object.fromEntries(
      ["@nestjs/common", "@nestjs/core", "@nestjs/testing", "rxjs"].map((name) => [
        name,
        [join(ROOT, "integrations/nestjs/node_modules", name)],
      ]),
    ),
  },
};

/**
 * The page paths listed in the docs structure plan, relative to `docs/<language>/v1/`. The plan is local working
 * material (not in the repository): without it a link must point at a page that exists on disk.
 */
const structureFiles = async (): Promise<Set<string>> => {
  for (const path of ["DOCS-STRUCTURE.md", "docs-slopping/DOCS-STRUCTURE.md"]) {
    const file = Bun.file(join(ROOT, path));
    if (await file.exists()) {
      const text = await file.text();
      return new Set([...text.matchAll(/`([a-z0-9/-]+\.(?:mdx|json))`/g)].map((m) => m[1] as string));
    }
  }
  return new Set();
};

/** An explicit id at the end of a heading line: `## Быстрый путь [#quick-start]`. */
const EXPLICIT_ID = /\s*\[#([^\]]+)\]\s*$/;

/**
 * The anchor the build makes from a heading: its explicit id (`[#quick-start]`, the same in every language) when
 * it has one; otherwise components (`<Badge>…</Badge>`) and inline-code marks are dropped, the text is lower-cased,
 * punctuation except `-` and `_` removed, spaces become `-` (Cyrillic kept).
 *
 * @param heading - The heading text without the leading `#`s.
 * @returns The anchor, without `#`.
 */
const slug = (heading: string): string => {
  const explicit = EXPLICIT_ID.exec(heading)?.[1];
  if (explicit !== undefined) return explicit;
  return heading
    .replace(/<([A-Z][A-Za-z]*)[^>]*>[\s\S]*?<\/\1>|<[A-Z][^>]*\/>/g, "")
    .replace(/`/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
};

/** The anchors of the headings of a page (`#` lines outside code blocks). */
const anchorsOf = (text: string): Set<string> => {
  const found = new Set<string>();
  let code = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) code = !code;
    else if (!code) {
      const heading = /^#{1,6}\s+(.+)$/.exec(line);
      if (heading) found.add(slug(heading[1] as string));
    }
  }
  return found;
};

/** The `.mdx` files named on the command line (directories are walked). */
const collect = (paths: readonly string[]): string[] =>
  paths.flatMap((p) => {
    const full = resolve(p);
    if (statSync(full).isDirectory()) return collect(readdirSync(full).map((name) => join(full, name)));
    return full.endsWith(".mdx") ? [full] : [];
  });

/** Where a page lives inside its version folder (`docs/ru/v1/queries/x.mdx` → `queries/x.mdx`). */
const inVersion = (file: string): string | undefined => /(?:docs)\/[a-z]{2}\/v\d+\/(.+)$/.exec(file)?.[1];

let failures = 0;
const fail = (file: string, message: string): void => {
  failures++;
  console.log(`  ✗ ${relative(ROOT, file)}: ${message}`);
};

/** Compiles one twoslash block and compares its errors with `@errors`. */
const checkBlock = (file: string, index: number, raw: string, work: string): void => {
  const expected = [...raw.matchAll(/\/\/ @errors: ([\d ]+)/g)].flatMap((m) =>
    (m[1] as string).trim().split(/\s+/).map(Number),
  );
  const source = raw
    .replace(/ *\/\/ \[!code [^\]]+\]/g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\/ ---cut[a-z-]*---/.test(line) && !/\/\/ @errors:/.test(line))
    .join("\n");
  const dir = join(work, String(index));
  mkdirSync(dir, { recursive: true });
  const parts = source.split(/^\/\/ @filename: (.+)$/m);
  const files: string[] = [];
  if (parts.length === 1) {
    writeFileSync(join(dir, "index.ts"), source);
    files.push(join(dir, "index.ts"));
  } else {
    if ((parts[0] as string).trim()) {
      writeFileSync(join(dir, "_before.ts"), parts[0] as string);
      files.push(join(dir, "_before.ts"));
    }
    for (let k = 1; k < parts.length; k += 2) {
      const name = `${(parts[k] as string).trim().replace(/\.ts$/, "")}.ts`;
      writeFileSync(join(dir, name), parts[k + 1] as string);
      files.push(join(dir, name));
    }
  }
  const program = ts.createProgram(files, OPTIONS);
  const diagnostics = ts.getPreEmitDiagnostics(program).filter((d) => d.file?.fileName.startsWith(dir));
  const got = diagnostics.map((d) => d.code).sort();
  if (JSON.stringify(got) !== JSON.stringify([...expected].sort())) {
    fail(file, `twoslash block ${index + 1}: expected errors ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
    for (const d of diagnostics)
      console.log(
        `      TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ").slice(0, fullMessages ? undefined : 240)}`,
      );
  }
  if (!showTypes) return;
  const checker = program.getTypeChecker();
  for (const name of files) {
    const sf = program.getSourceFile(name);
    if (!sf) continue;
    sf.text.split("\n").forEach((line, row) => {
      if (!/^\s*\/\/\s*\^\?/.test(line) || row === 0) return;
      const position = sf.getPositionOfLineAndCharacter(row - 1, line.indexOf("^"));
      const find = (node: ts.Node): ts.Node | undefined =>
        node.getStart() <= position && position < node.getEnd() ? (ts.forEachChild(node, find) ?? node) : undefined;
      const node = find(sf);
      if (node) {
        const type = checker.typeToString(checker.getTypeAtLocation(node), undefined, ts.TypeFormatFlags.NoTruncation);
        console.log(`      block ${index + 1} ^? ${node.getText()}: ${type}`);
      }
    });
  }
};

/** Checks one page. */
const checkPage = async (file: string, known: Set<string>): Promise<void> => {
  const text = await Bun.file(file).text();
  console.log(relative(ROOT, file));
  /* front matter */
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1];
  if (front === undefined) fail(file, "no front matter");
  else {
    const title = /^title: *(.+)$/m.exec(front)?.[1];
    const description = /^description: *(.+)$/m.exec(front)?.[1]?.replace(/^"|"$/g, "");
    if (!title) fail(file, "front matter: no title");
    if (!description) fail(file, "front matter: no description");
    else if (description.length > 160)
      fail(file, `front matter: description is ${description.length} characters (max 160)`);
  }
  /* MDX pitfalls in prose */
  let inCode = false;
  let inTag = false;
  text.split("\n").forEach((line, row) => {
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      return;
    }
    if (inCode || row === 0) return;
    /* the attributes of a component may span lines: `<TypeTable type={{ … }} />` */
    if (inTag) {
      if (/\/?>\s*$/.test(line)) inTag = false;
      return;
    }
    if (/^\s*<[A-Z][A-Za-z]*(\s|$)/.test(line) && !/>\s*$/.test(line)) {
      inTag = true;
      return;
    }
    const prose = line.replace(/``[^`]*``/g, "").replace(/`[^`]*`/g, "");
    if (/^\s*<\/?[A-Z]/.test(prose) || /^\s*\{\/\*/.test(prose) || /^\s*---\s*$/.test(prose)) return;
    const stripped = prose.replace(/<\/?[A-Z][A-Za-z]*(?:\s[^>]*)?\/?>/g, "");
    if (/[{}<>]/.test(stripped)) fail(file, `line ${row + 1}: "{", "}", "<" or ">" in prose — put it in inline code`);
  });
  /* links */
  const here = inVersion(file);
  for (const match of text.matchAll(/\]\((\.{1,2}\/[^)#\s]+)(#[^)\s]*)?\)/g)) {
    const target = match[1] as string;
    if (!target.endsWith(".mdx")) fail(file, `link ${target}: a relative link points to an .mdx page`);
    const onDisk = resolve(dirname(file), target);
    const inStructure = here === undefined ? undefined : normalize(join(dirname(here), target));
    const exists = await Bun.file(onDisk).exists();
    if (!exists && !(inStructure !== undefined && known.has(inStructure)))
      fail(file, `link ${target}: no such page on disk or in DOCS-STRUCTURE.md`);
    const anchor = match[2]?.slice(1);
    if (exists && anchor !== undefined && !anchorsOf(await Bun.file(onDisk).text()).has(decodeURIComponent(anchor)))
      fail(file, `link ${target}#${anchor}: no such anchor in that page`);
  }
  /* anchors inside the page */
  const own = anchorsOf(text);
  for (const match of text.matchAll(/\]\(#([^)\s]+)\)/g)) {
    if (!own.has(decodeURIComponent(match[1] as string))) fail(file, `link #${match[1]}: no such anchor on this page`);
  }
  /* twoslash blocks */
  const blocks = [...text.matchAll(/```ts twoslash[^\n]*\n([\s\S]*?)\n```/g)].map((m) => m[1] as string);
  const work = mkdtempSync(join(tmpdir(), "docs-check-"));
  try {
    for (const [index, raw] of blocks.entries()) checkBlock(file, index, raw, work);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`  ${blocks.length} twoslash blocks`);
};

const known = await structureFiles();
const files = collect(targets);
if (files.length === 0) {
  console.log("usage: bun scripts/docs-check.ts [--types] <file.mdx | dir> ...");
  process.exit(1);
}
for (const file of files) await checkPage(file, known);
console.log(failures === 0 ? `ok: ${files.length} page(s)` : `${failures} problem(s) in ${files.length} page(s)`);
process.exit(failures === 0 ? 0 : 1);
