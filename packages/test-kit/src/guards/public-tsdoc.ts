import { join, relative } from "node:path";
import ts from "typescript";
import { TsConfig } from "../types/ts-config.ts";

/*
 * The TSDoc a user reads: the comments of the declarations exported from the public entry points and of their
 * public members, as the IDE shows them on hover. Shared by `scripts/check-tsdoc-examples.ts` (the `@example`
 * blocks must compile) and the guard that keeps internal ids out of the public TSDoc.
 */

/**
 * One TSDoc comment of the public API.
 *
 * @example
 * ```ts
 * const [first]: readonly PublicComment[] = PublicTsdoc.collect().comments;
 * ```
 */
export interface PublicComment {
  /** Repository-relative source file. */
  readonly file: string;
  /** The parsed source file. */
  readonly source: ts.SourceFile;
  /** The comment. */
  readonly doc: ts.JSDoc;
  /** The documented declaration (`Class.member`). */
  readonly owner: string;
  /** The entry the declaration is exported from. */
  readonly entry: string;
}

/**
 * The public TSDoc of every entry, and the names each entry exports.
 *
 * @example
 * ```ts
 * const { comments, exportsOf }: PublicTsdocResult = PublicTsdoc.collect();
 * ```
 */
export interface PublicTsdocResult {
  /** Every public TSDoc comment, each once (a declaration reached through two exports is read once). */
  readonly comments: readonly PublicComment[];
  /** Per entry, its exported names. */
  readonly exportsOf: ReadonlyMap<string, readonly string[]>;
}

/** Walks the public API of the packages and collects the TSDoc a user can see. */
export class PublicTsdoc {
  /** The published entry points: import specifier → repository-relative source file. */
  static readonly ENTRIES: Readonly<Record<string, string>> = {
    "@venloc/typemo": "packages/typemo/src/index.ts",
    "@venloc/typemo/testing": "packages/typemo/src/testing/index.ts",
    "@venloc/typemo/adapters": "packages/typemo/src/adapters.ts",
    "@venloc/typemo-decorators": "packages/decorators/src/index.ts",
    "@venloc/typemo-opentelemetry": "integrations/opentelemetry/src/index.ts",
    "@venloc/typemo-sentry": "integrations/sentry/src/index.ts",
    "@venloc/typemo-nestjs": "integrations/nestjs/src/index.ts",
    "@venloc/typemo-nestjs/testing": "integrations/nestjs/src/testing/index.ts",
  };

  /**
   * Compiler options that resolve every entry and the driver from the working tree.
   *
   * @returns Options for a program over the entries (legacy decorators, the product's strictness).
   */
  static compilerOptions(): ts.CompilerOptions {
    const root = TsConfig.repoRoot;
    return {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.Preserve,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      moduleDetection: ts.ModuleDetectionKind.Force,
      strict: true,
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
      experimentalDecorators: true,
      useDefineForClassFields: false,
      skipLibCheck: true,
      noEmit: true,
      allowImportingTsExtensions: true,
      types: ["bun"],
      typeRoots: [join(root, "node_modules/@types")],
      paths: {
        ...Object.fromEntries(Object.entries(PublicTsdoc.ENTRIES).map(([name, file]) => [name, [join(root, file)]])),
        mongodb: [join(root, "packages/typemo/node_modules/mongodb")],
        // The NestJS integration's examples import Nest itself, installed in that package only.
        ...Object.fromEntries(
          ["@nestjs/common", "@nestjs/core", "@nestjs/testing", "rxjs"].map((name) => [
            name,
            [join(root, "integrations/nestjs/node_modules", name)],
          ]),
        ),
      },
    };
  }

  /**
   * Every public TSDoc comment, with the exported names of each entry. `@internal` declarations and `private`,
   * `protected` and `#private` members are skipped.
   *
   * @returns The comments and the export lists.
   * @throws Error - When an entry is not in the program or is not a module.
   */
  static collect(): PublicTsdocResult {
    const root = TsConfig.repoRoot;
    const program = ts.createProgram(
      Object.values(PublicTsdoc.ENTRIES).map((file) => join(root, file)),
      PublicTsdoc.compilerOptions(),
    );
    const checker = program.getTypeChecker();
    const comments: PublicComment[] = [];
    const exportsOf = new Map<string, readonly string[]>();
    const seen = new Set<string>();
    for (const [entry, file] of Object.entries(PublicTsdoc.ENTRIES)) {
      const source = program.getSourceFile(join(root, file));
      const module = source === undefined ? undefined : checker.getSymbolAtLocation(source);
      if (module === undefined) throw new Error(`PublicTsdoc: the entry ${file} is not a module of the program`);
      const names: string[] = [];
      for (const exported of checker.getExportsOfModule(module)) {
        names.push(exported.name);
        const target = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
        for (const declaration of target.declarations ?? []) {
          PublicTsdoc.visit(declaration, exported.name, entry, comments, seen);
        }
      }
      exportsOf.set(entry, names);
    }
    return { comments, exportsOf };
  }

  /**
   * Collects the comments of one declaration and of its public members.
   *
   * @param node - The declaration.
   * @param owner - Its display name.
   * @param entry - The entry it is exported from.
   * @param comments - Receives the comments.
   * @param seen - Comments already collected.
   */
  static visit(node: ts.Node, owner: string, entry: string, comments: PublicComment[], seen: Set<string>): void {
    if (ts.getJSDocTags(node).some((tag) => tag.tagName.text === "internal")) return;
    for (const doc of ts.getJSDocCommentsAndTags(node)) {
      if (!ts.isJSDoc(doc)) continue;
      const source = doc.getSourceFile();
      const key = `${source.fileName}:${doc.pos}`;
      if (seen.has(key)) continue;
      seen.add(key);
      comments.push({ file: relative(TsConfig.repoRoot, source.fileName), source, doc, owner, entry });
    }
    for (const member of PublicTsdoc.membersOf(node)) {
      const modifiers = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : [];
      const hidden = modifiers.some(
        (modifier) =>
          modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword,
      );
      if (hidden || (member.name !== undefined && ts.isPrivateIdentifier(member.name))) continue;
      PublicTsdoc.visit(member, `${owner}.${member.name?.getText() ?? "?"}`, entry, comments, seen);
    }
  }

  /**
   * The members of a class, an interface, an object type alias or an object literal constant.
   *
   * @param node - The declaration.
   * @returns Its members.
   */
  static membersOf(node: ts.Node): readonly (ts.ClassElement | ts.TypeElement | ts.ObjectLiteralElementLike)[] {
    if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) return node.members;
    if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) return node.type.members;
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      return node.initializer.properties;
    }
    return [];
  }

  /**
   * The raw text of a comment (with its `*` margins) and the 1-based line it starts on.
   *
   * @param comment - The comment.
   * @returns The text and its first line.
   */
  static textOf(comment: PublicComment): { readonly text: string; readonly line: number } {
    const start = comment.doc.getStart(comment.source);
    return {
      text: comment.source.text.slice(start, comment.doc.end),
      line: comment.source.getLineAndCharacterOfPosition(start).line + 1,
    };
  }
}
