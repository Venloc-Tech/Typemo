/*
 * `bun run check:tsdoc`: compiles every ```ts block inside an `@example` of the public TSDoc — the declarations
 * exported from the package entry points and their public members (`@internal`, `private`, `protected` and
 * `#private` skipped) — the way a reader would paste it into a project:
 *  - the public names the block uses are imported from the entries automatically (its own entry first);
 *  - the reader's context the block assumes (a `connection`, the models `User`, `Post`, `Order`, a loaded
 *    `user`, …) is added from READER_CONTEXT when the block uses the name and does not declare it itself;
 *  - blocks of `@venloc/typemo-decorators` (or marked ```ts tc39) compile with TC39 decorators, the others with
 *    the legacy decorators of the core;
 *  - a block that cannot compile on its own (a piece of a class body, a signature) is marked ```ts fragment in
 *    the TSDoc: it is only parsed, and it must still be valid syntax. No other block may produce any error,
 *    an unknown name included;
 *  - a line holding only `...` is an elision and is dropped.
 * Usage: `bun run check:tsdoc [--full] [--list]` — exits with 1 when a block fails; `--full` prints compiler
 * messages whole (cut at 240 characters otherwise), `--list` prints every block with its verdict.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { type PublicComment, PublicTsdoc } from "../packages/test-kit/src/guards/public-tsdoc.ts";

const fullMessages = process.argv.includes("--full");
const listAll = process.argv.includes("--list");

/** The entry whose examples use the standard (TC39) decorators. */
const TC39_ENTRY = "@venloc/typemo-decorators";

/** The strictness the product recommends, with the legacy decorators of the core. */
const LEGACY_OPTIONS: ts.CompilerOptions = PublicTsdoc.compilerOptions();

/** The same, with the standard decorators (what a project of `@venloc/typemo-decorators` compiles with). */
const TC39_OPTIONS: ts.CompilerOptions = {
  ...LEGACY_OPTIONS,
  experimentalDecorators: false,
  useDefineForClassFields: true,
};

/**
 * The reader's context: what an example may use without declaring it, as a reader of the API reference would
 * have it in the project. A chunk is added only when the block uses the name and does not declare it; `deps`
 * are added first. The public API is reached through `T.` and the decorators through `D.` (the core's or the
 * TC39 package's, by the block's mode), so a chunk never clashes with the block's own imports.
 */
const READER_CONTEXT: Readonly<Record<string, { readonly deps: readonly string[]; readonly code: string }>> = {
  ObjectId: { deps: [], code: `import { ObjectId } from "mongodb";` },
  Decimal128: { deps: [], code: `import { Decimal128 } from "mongodb";` },
  Binary: { deps: [], code: `import { Binary } from "mongodb";` },
  UUID: { deps: [], code: `import { UUID } from "mongodb";` },
  client: { deps: [], code: "declare const client: T.TypemoClient;" },
  connection: { deps: [], code: "declare const connection: T.Connection;" },
  session: { deps: [], code: `declare const session: import("mongodb").ClientSession;` },
  email: { deps: [], code: "declare const email: string;" },
  /* `f`: the field references an expression callback receives (`(f) => fn.add(f.price, 1)`). */
  f: {
    deps: [],
    code: "declare const f: T.FieldProxy<{ name: string; first: string; last: string; price: number; total: number; score: number }>;",
  },
  Address: {
    deps: [],
    code: `@D.Schema({ nested: true })
class Address {
  @D.Prop(() => String) city?: string;
}`,
  },
  User: {
    deps: ["Address"],
    code: `@D.Schema({ collection: "users" })
class User extends T.Entity {
  @D.Prop(() => String, { required: true }) name!: string;
  @D.Prop(() => String) email?: string;
  @D.Prop(() => Number) age?: number;
  @D.Prop(() => Boolean) active?: boolean;
  @D.Prop(() => [String], { default: () => [] }) tags!: T.Defaulted<string[]>;
  @D.Prop(() => T.Spec.map(Number), { default: () => new Map() }) scores!: T.Defaulted<Map<string, number>>;
  @D.Prop(() => String, { hidden: true }) passwordHash?: T.Hidden<string>;
  @D.Prop(() => Date) createdAt?: Date;
  @D.Prop(() => String) role?: string;
  @D.Prop(() => Address, { default: () => ({}) }) address!: T.Defaulted<Address>;
}`,
  },
  Users: { deps: ["User", "connection"], code: "const Users = connection.model(User);" },
  users: { deps: ["User", "connection"], code: "const users = connection.model(User);" },
  user: { deps: ["User"], code: "declare const user: T.HydratedDoc<User>;" },
  doc: { deps: ["User"], code: "declare const doc: T.HydratedDoc<User>;" },
  Post: {
    deps: ["User"],
    code: `@D.Schema({ collection: "posts" })
class Post extends T.Entity {
  @D.Prop(() => String, { required: true }) title!: string;
  @D.Prop(() => T.Types.ObjectId, { ref: () => User }) author?: T.Ref<User>;
}`,
  },
  Posts: { deps: ["Post", "connection"], code: "const Posts = connection.model(Post);" },
  Line: {
    deps: [],
    code: `@D.Schema()
class Line extends T.Entity {
  @D.Prop(() => String, { required: true }) sku!: string;
  @D.Prop(() => Number, { required: true }) qty!: number;
}`,
  },
  Order: {
    deps: ["Line"],
    code: `@D.Schema({ collection: "orders" })
class Order extends T.Entity {
  @D.Prop(() => T.Types.ObjectId) customerId?: T.Types.ObjectId;
  @D.Prop(() => Number, { required: true }) amount!: number;
  @D.Prop(() => String) status?: string;
  @D.Prop(() => [Line]) lines!: Line[];
}`,
  },
  Orders: { deps: ["Order", "connection"], code: "const Orders = connection.model(Order);" },
};

/** An example block found in the TSDoc. */
interface ExampleBlock {
  /** Repository-relative source file. */
  readonly file: string;
  /** 1-based line of the block's first code line in the source file. */
  readonly line: number;
  /** The documented declaration (`Class.member`). */
  readonly owner: string;
  /** The entry the declaration is exported from. */
  readonly entry: string;
  /** The code of the block. */
  readonly code: string;
  /** Marked ```ts fragment: parsed only. */
  readonly fragment: boolean;
  /** Compiled with the standard decorators. */
  readonly tc39: boolean;
}

/** A block written out for the compiler. */
interface WrittenBlock {
  /** The block. */
  readonly block: ExampleBlock;
  /** The file handed to the compiler. */
  readonly path: string;
  /** Lines added before the block's code (imports, reader's context). */
  readonly headerLines: number;
}

/** The TSDoc example checker. */
class TsdocExamples {
  /**
   * The ```ts blocks of one public TSDoc comment's `@example` tags, located in the source file by their fences.
   *
   * @param comment - The comment.
   * @returns The blocks.
   */
  static blocksOf(comment: PublicComment): ExampleBlock[] {
    const blocks: ExampleBlock[] = [];
    for (const tag of comment.doc.tags ?? []) {
      if (tag.tagName.text !== "example") continue;
      const text = ts.getTextOfJSDocComment(tag.comment) ?? "";
      const raw = comment.source.text.slice(tag.pos, tag.end);
      const fences = [...raw.matchAll(/```(?:ts|typescript)\b/g)];
      let index = 0;
      for (const match of text.matchAll(/```(?:ts|typescript)\b([^\n]*)\n([\s\S]*?)```/g)) {
        const info = (match[1] ?? "").trim().split(/\s+/);
        const fence = fences[index++];
        const at = fence === undefined ? tag.pos : tag.pos + (fence.index ?? 0);
        blocks.push({
          file: comment.file,
          line: comment.source.getLineAndCharacterOfPosition(at).line + 2,
          owner: comment.owner,
          entry: comment.entry,
          code: match[2] ?? "",
          fragment: info.includes("fragment"),
          tc39: comment.entry === TC39_ENTRY || info.includes("tc39"),
        });
      }
    }
    return blocks;
  }

  /**
   * The reader's context a block needs.
   *
   * @param words - The identifiers the block uses.
   * @param declared - The names the block declares itself.
   * @param tc39 - The block's decorator mode.
   * @returns The prelude lines, empty when the block needs no context.
   */
  static contextFor(words: ReadonlySet<string>, declared: ReadonlySet<string>, tc39: boolean): string[] {
    const wanted: string[] = [];
    const add = (name: string): void => {
      const chunk = READER_CONTEXT[name];
      if (chunk === undefined || wanted.includes(name) || declared.has(name)) return;
      for (const dep of chunk.deps) add(dep);
      wanted.push(name);
    };
    for (const name of Object.keys(READER_CONTEXT)) if (words.has(name)) add(name);
    if (wanted.length === 0) return [];
    return [
      `import * as T from "@venloc/typemo";`,
      `import * as D from "${tc39 ? TC39_ENTRY : "@venloc/typemo"}";`,
      ...wanted.flatMap((name) => (READER_CONTEXT[name]?.code ?? "").split("\n")),
    ];
  }

  /**
   * Writes a block as a module: its imports of public names, the reader's context, the code.
   *
   * @param block - The block.
   * @param path - Where to write it.
   * @param exportsOf - The exported names of each entry.
   * @returns The written block.
   */
  static write(block: ExampleBlock, path: string, exportsOf: ReadonlyMap<string, readonly string[]>): WrittenBlock {
    const code = block.code.replace(/^\s*\.\.\.\s*$/gm, "");
    const declared = new Set(
      [...code.matchAll(/\b(?:class|interface|type|const|let|var|using|function|enum)\s+([A-Za-z_$][\w$]*)/g)].map(
        (match) => match[1] as string,
      ),
    );
    const imported = new Set(
      [...code.matchAll(/import\s+[^;]*?from/g)].flatMap((match) => match[0].match(/[\w$]+/g) ?? []),
    );
    const words = new Set(code.match(/[A-Za-z_$][\w$]*/g) ?? []);
    const header: string[] = [];
    const order = [block.entry, ...[...exportsOf.keys()].filter((entry) => entry !== block.entry)];
    for (const entry of order) {
      if (block.tc39 === false && entry === TC39_ENTRY) continue;
      const use = (exportsOf.get(entry) ?? []).filter(
        (name) => words.has(name) && !(name in READER_CONTEXT) && !declared.has(name) && !imported.has(name),
      );
      for (const name of use) imported.add(name);
      if (use.length > 0) header.push(`import { ${use.join(", ")} } from "${entry}";`);
    }
    header.push(...TsdocExamples.contextFor(words, declared, block.tc39));
    writeFileSync(path, `${header.join("\n")}\n${code}\n`);
    return { block, path, headerLines: header.length };
  }

  /**
   * Compiles the written blocks of one decorator mode.
   *
   * @param written - The blocks.
   * @param options - The compiler options of the mode.
   * @returns The failure lines of each failing block.
   */
  static compile(written: readonly WrittenBlock[], options: ts.CompilerOptions): Map<WrittenBlock, string[]> {
    const failures = new Map<WrittenBlock, string[]>();
    if (written.length === 0) return failures;
    const program = ts.createProgram(
      written.map((one) => one.path),
      options,
    );
    for (const one of written) {
      const source = program.getSourceFile(one.path);
      if (source === undefined) throw new Error(`check-tsdoc-examples: the compiler lost ${one.path}`);
      const diagnostics = one.block.fragment
        ? program.getSyntacticDiagnostics(source)
        : [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)];
      if (diagnostics.length === 0) continue;
      failures.set(
        one,
        diagnostics.map((diagnostic) => {
          const at =
            diagnostic.start === undefined ? undefined : source.getLineAndCharacterOfPosition(diagnostic.start).line;
          const offset = at === undefined ? undefined : at - one.headerLines;
          const where = offset === undefined || offset < 0 ? "context" : `line ${one.block.line + offset}`;
          const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
          return `${where} TS${diagnostic.code}: ${fullMessages ? message : message.slice(0, 240)}`;
        }),
      );
    }
    return failures;
  }

  /**
   * Runs the check and prints the report.
   *
   * @returns The process exit code: 0 when every block passes.
   */
  static run(): number {
    const { comments, exportsOf } = PublicTsdoc.collect();
    const blocks = comments.flatMap((comment) => TsdocExamples.blocksOf(comment));
    const work = mkdtempSync(join(tmpdir(), "check-tsdoc-"));
    try {
      const written = blocks.map((block, index) => TsdocExamples.write(block, join(work, `b${index}.ts`), exportsOf));
      const failures = new Map([
        ...TsdocExamples.compile(
          written.filter((one) => !one.block.tc39),
          LEGACY_OPTIONS,
        ),
        ...TsdocExamples.compile(
          written.filter((one) => one.block.tc39),
          TC39_OPTIONS,
        ),
      ]);
      for (const one of written) {
        const lines = failures.get(one);
        const { file, line, owner } = one.block;
        if (lines === undefined) {
          if (listAll) console.log(`  ok ${file}:${line} (${owner})${one.block.fragment ? " fragment" : ""}`);
          continue;
        }
        console.log(`  ✗ ${file}:${line} (${owner})${one.block.fragment ? " fragment" : ""}`);
        for (const text of lines) console.log(`      ${text}`);
      }
      const fragments = blocks.filter((block) => block.fragment).length;
      const tc39 = blocks.filter((block) => block.tc39).length;
      console.log(
        `${blocks.length} example block(s): ${blocks.length - fragments} compiled (${tc39} with TC39 decorators), ` +
          `${fragments} fragment(s) parsed; ${failures.size} failing`,
      );
      return failures.size === 0 ? 0 : 1;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
}

process.exit(TsdocExamples.run());
