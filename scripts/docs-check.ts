/*
 * Checks documentation pages (`.mdx`) the way the docs build will. First every `<Snippet id="…" />` tag outside code
 * blocks is expanded into the code block it stands for (`snippets/<version>/[<language>/]<id>.<ext>`, `id="file#region"`
 * takes one `#region`; see `Snippets`); a tag without a file or region is a failure. Then on the expanded page:
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
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

/** Where a line of an expanded page comes from: the page line (1-based) and, inside a snippet, the snippet file. */
export type Origin = { line: number; snippet?: string };

/** A page with its `<Snippet />` tags replaced by the code blocks they stand for. */
export type Expanded = { text: string; origins: Origin[]; problems: string[] };

/**
 * Expands `<Snippet id="…" />` tags the way the docs site renders them, so that every check sees the code blocks the
 * reader sees. The file is `snippets/<version>/<language>/<id>.<ext>`, else `snippets/<version>/<id>.<ext>`.
 */
export class Snippets {
  static readonly DIR = join(ROOT, "snippets");
  static readonly TAG = /^([ \t]*)<Snippet((?:\s+[a-zA-Z]+(?:="[^"]*")?)*)\s*\/>\s*$/;
  static readonly PROPS = new Set([
    "id",
    "title",
    "twoslash",
    "highlight",
    "lineNumbers",
    "noCopy",
    "lang",
    "meta",
    "version",
  ]);
  static readonly LANG_OF_EXT: Readonly<Record<string, string>> = { sh: "bash", txt: "text" };
  /* `// #region x`, `# #region x` or `#region x`, `/* #region x *\/`, `<!-- #region x -->`. */
  static readonly REGION = /^\s*(?:\/\/|\/\*|<!--|#)?\s*#(end)?region\b[ \t]*([^\s*]*)[ \t]*(?:\*\/|-->)?\s*$/;

  /** The files that can hold an id, in resolution order, and the one that exists (an id with several extensions is ambiguous). */
  static resolve(id: string, language: string | undefined, version: string): { tried: string[]; found: string[] } {
    const bases = [
      ...(language === undefined ? [] : [join(Snippets.DIR, version, language, id)]),
      join(Snippets.DIR, version, id),
    ];
    const tried = bases.map((base) => `${relative(ROOT, base)}.*`);
    for (const base of bases) {
      const dir = dirname(base);
      const name = `${base.slice(dir.length + 1)}.`;
      const found = statSync(dir, { throwIfNoEntry: false })?.isDirectory()
        ? readdirSync(dir)
            .filter((entry) => entry.startsWith(name) && !entry.slice(name.length).includes("."))
            .map((entry) => join(dir, entry))
            .filter((path) => statSync(path).isFile())
        : [];
      if (found.length > 0) return { tried, found };
    }
    return { tried, found: [] };
  }

  /** The lines between `#region name` and its `#endregion`, without nested markers and common indentation. */
  static region(lines: readonly string[], name: string): string[] | undefined {
    const start = lines.findIndex((line) => {
      const marker = Snippets.REGION.exec(line);
      return marker !== null && marker[1] === undefined && marker[2] === name;
    });
    if (start < 0) return undefined;
    const body: string[] = [];
    let depth = 0;
    for (const line of lines.slice(start + 1)) {
      const marker = Snippets.REGION.exec(line);
      if (marker?.[1] !== undefined && depth === 0) {
        const indent = Math.min(
          ...body.filter((l) => l.trim() !== "").map((l) => (/^[ \t]*/.exec(l)?.[0] ?? "").length),
        );
        return body.map((l) => (l.trim() === "" ? "" : l.slice(Number.isFinite(indent) ? indent : 0)));
      }
      if (marker) depth += marker[1] === undefined ? 1 : -1;
      else body.push(line);
    }
    return undefined;
  }

  /** The fence info string of a tag: the language, then the props in the order the pages wrote them before. */
  static info(lang: string, props: ReadonlyMap<string, string | true>): string {
    const highlight = props.get("highlight");
    return [
      lang,
      props.has("twoslash") ? "twoslash" : "",
      props.has("title") ? `title="${props.get("title")}"` : "",
      typeof highlight === "string" ? `{${highlight}}` : "",
      props.has("lineNumbers") ? "showLineNumbers" : "",
      props.has("noCopy") ? "noCopy" : "",
      String(props.get("meta") ?? ""),
    ]
      .filter((part) => part !== "")
      .join(" ");
  }

  /** Expands every tag of a page outside fenced code blocks; a tag that cannot be expanded stays and is a problem. */
  static expand(file: string, text: string): Expanded {
    const place = /docs\/([a-z]{2})\/(?:(v\d+)\/)?/.exec(file);
    const language = place?.[1];
    const out: string[] = [];
    const origins: Origin[] = [];
    const problems: string[] = [];
    let code = false;
    for (const [row, line] of text.split("\n").entries()) {
      const keep = (): void => {
        out.push(line);
        origins.push({ line: row + 1 });
      };
      if (/^\s*```/.test(line)) code = !code;
      if (code || !/^\s*<Snippet\b/.test(line)) {
        keep();
        continue;
      }
      const where = `line ${row + 1}: <Snippet />`;
      const tag = Snippets.TAG.exec(line);
      const props = new Map<string, string | true>();
      for (const prop of (tag?.[2] ?? "").matchAll(/([a-zA-Z]+)(?:="([^"]*)")?/g))
        props.set(
          prop[1] as string,
          prop[2] === undefined ? true : prop[2].replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
        );
      const unknown = [...props.keys()].filter((name) => !Snippets.PROPS.has(name));
      const id = props.get("id");
      if (!tag || unknown.length > 0 || typeof id !== "string" || id === "") {
        problems.push(
          `${where} cannot be read (${unknown.length > 0 ? `unknown ${unknown.join(", ")}` : 'needs id="…"'})`,
        );
        keep();
        continue;
      }
      const [path = "", regionName] = id.split("#");
      if (/^(?:ru|en)\//.test(path) || (language !== undefined && path.startsWith(`${language}/`))) {
        problems.push(`${where} id "${id}" starts with a language code (the language folder is chosen by the page)`);
        keep();
        continue;
      }
      if (path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
        problems.push(`${where} id "${id}" is not a relative path inside snippets/`);
        keep();
        continue;
      }
      const version = props.get("version");
      const { tried, found } = Snippets.resolve(
        path,
        language,
        typeof version === "string" ? version : (place?.[2] ?? "WITHOUT_VERSION"),
      );
      const snippet = found[0];
      if (snippet === undefined || found.length > 1) {
        problems.push(
          snippet === undefined
            ? `${where} no file for id "${id}" (tried ${tried.join(", ")})`
            : `${where} id "${id}" has several files: ${found.map((f) => relative(ROOT, f)).join(", ")}`,
        );
        keep();
        continue;
      }
      const content = readFileSync(snippet, "utf8").replace(/\n$/, "");
      const lines = content === "" ? [] : content.split("\n");
      const body = regionName === undefined ? lines : Snippets.region(lines, regionName);
      if (body === undefined) {
        problems.push(`${where} no region "${regionName}" in ${relative(ROOT, snippet)}`);
        keep();
        continue;
      }
      const ext = snippet.slice(snippet.lastIndexOf(".") + 1);
      const lang = props.get("lang");
      const indent = tag[1] as string;
      const fenced = [
        `${indent}\`\`\`${Snippets.info(typeof lang === "string" ? lang : (Snippets.LANG_OF_EXT[ext] ?? ext), props)}`,
        ...body.map((l) => (l === "" ? "" : indent + l)),
        `${indent}\`\`\``,
      ];
      out.push(...fenced);
      for (const _ of fenced) origins.push({ line: row + 1, snippet: relative(ROOT, snippet) });
    }
    return { text: out.join("\n"), origins, problems };
  }
}

/** How a message names a line of an expanded page: the page line, plus the snippet file when the line comes from one. */
const at = (origin: Origin | undefined): string =>
  origin === undefined ? "line ?" : `line ${origin.line}${origin.snippet ? ` (snippet ${origin.snippet})` : ""}`;

let failures = 0;
const fail = (file: string, message: string): void => {
  failures++;
  console.log(`  ✗ ${relative(ROOT, file)}: ${message}`);
};

/** Compiles one twoslash block and compares its errors with `@errors`. */
const checkBlock = (file: string, index: number, raw: string, work: string, origin: Origin | undefined): void => {
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
    fail(
      file,
      `twoslash block ${index + 1}, ${at(origin)}: expected errors ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`,
    );
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
  const expanded = Snippets.expand(file, await Bun.file(file).text());
  const { text, origins } = expanded;
  console.log(relative(ROOT, file));
  for (const problem of expanded.problems) fail(file, problem);
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
    if (/[{}<>]/.test(stripped))
      fail(file, `${at(origins[row])}: "{", "}", "<" or ">" in prose — put it in inline code`);
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
  const blocks = [...text.matchAll(/```ts twoslash[^\n]*\n([\s\S]*?)\n```/g)].map((m) => ({
    raw: m[1] as string,
    origin: origins[text.slice(0, m.index).split("\n").length - 1],
  }));
  const work = mkdtempSync(join(tmpdir(), "docs-check-"));
  try {
    for (const [index, block] of blocks.entries()) checkBlock(file, index, block.raw, work, block.origin);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`  ${blocks.length} twoslash blocks`);
};

/* Run only as a script: the snippet expansion is imported by checks of the snippet files themselves. */
if (import.meta.main) {
  const known = await structureFiles();
  const files = collect(targets);
  if (files.length === 0) {
    console.log("usage: bun scripts/docs-check.ts [--types] <file.mdx | dir> ...");
    process.exit(1);
  }
  for (const file of files) await checkPage(file, known);
  console.log(failures === 0 ? `ok: ${files.length} page(s)` : `${failures} problem(s) in ${files.length} page(s)`);
  process.exit(failures === 0 ? 0 : 1);
}
