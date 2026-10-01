import { isAbsolute, relative, resolve } from "node:path";
import ts from "typescript";
import { TsConfig } from "../types/ts-config.ts";

/**
 * An agreed exception: a public path that may contain `any`, and why.
 *
 * @example
 * ```ts
 * const allow: AnyAllowEntry = { path: "Model.find(filter)", reason: "filter is checked by a conditional type" };
 * ```
 */
export interface AnyAllowEntry {
  /** Exact finding path (`Model.find(filter)`) or a pattern over it. */
  readonly path: string | RegExp;
  /** Why the exception is acceptable. */
  readonly reason: string;
}

/**
 * One place where `any` reaches the public API.
 *
 * @example
 * ```ts
 * const finding: AnyFinding = report.findings[0]!;
 * ```
 */
export interface AnyFinding {
  /** Where in the API: `Export.prop`, `Export(param)`, `Export()` (return), `Export[string]`, `Export<T>`. */
  readonly path: string;
  /**
   * `type` — the checker resolved a type to `any` (explicit or inferred);
   * `syntax` — an `any` keyword in a declaration.
   */
  readonly via: "type" | "syntax";
  /** Repo-relative file of the declaration. */
  readonly file: string;
  /** 1-based line of the declaration. */
  readonly line: number;
  /** The offending type or declaration text. */
  readonly text: string;
}

/**
 * Options of `NoAnyInPublicApi.scan`.
 *
 * @example
 * ```ts
 * const options: NoAnyOptions = { entry: "packages/typemo/src/index.ts", maxDepth: 8 };
 * ```
 */
export interface NoAnyOptions {
  /** Package entry to scan (`packages/typemo/src/index.ts`, or an emitted `index.d.ts`). Repo-relative or absolute. */
  readonly entry: string;
  /** tsconfig for compiler options; defaults to `tsconfig.test.json` (workspace `paths`, legacy decorators). */
  readonly tsconfig?: string;
  /** Agreed exceptions. */
  readonly allowlist?: readonly AnyAllowEntry[];
  /** How deep to follow nested types (default 12). Recursive types are cut by identity, not by depth. */
  readonly maxDepth?: number;
}

/**
 * The outcome of `NoAnyInPublicApi.scan`.
 *
 * @example
 * ```ts
 * const report: NoAnyReport = NoAnyInPublicApi.scan({ entry: "packages/typemo/src/index.ts" });
 * ```
 */
export interface NoAnyReport {
  /** The scanned entry, repo-relative. */
  readonly entry: string;
  /** Names of every export of the entry. */
  readonly exports: readonly string[];
  /** Findings not covered by the allowlist: these fail the guard. */
  readonly findings: readonly AnyFinding[];
  /** Findings covered by an allowlist entry. */
  readonly allowed: readonly AnyFinding[];
  /** Allowlist entries that matched nothing: stale, remove them. */
  readonly unusedAllowEntries: readonly AnyAllowEntry[];
}

/** Mutable state of one scan; kept out of the public types. */
interface ScanState {
  /** The program being scanned. */
  readonly program: ts.Program;
  /** The program's checker. */
  readonly checker: ts.TypeChecker;
  /** How deep to follow nested types. */
  readonly maxDepth: number;
  /** Findings by de-duplication key. */
  readonly findings: Map<string, AnyFinding>;
  /** Declarations already scanned for `any` keywords. */
  readonly scannedDeclarations: Set<ts.Node>;
  /** Generic declarations (class/interface targets) whose declared type was already walked. */
  readonly walkedTargets: Set<ts.Type>;
}

/**
 * Guard for the "no `any` in the public API" rule. It walks every export of a
 * package entry with the compiler API and reports `any` in two ways:
 *
 * - semantically: the resolved type of each export is walked recursively (properties, call and
 *   construct signatures, index signatures, type parameters, union/intersection members, type
 *   arguments of library types such as `Promise<any>`), so an *inferred* `any` is caught too;
 * - syntactically: every declaration of the package that the walk reaches (including non-exported
 *   helper aliases) is scanned for the `any` keyword in type positions, which catches `any` hidden
 *   in conditional-type branches that the checker does not expose. Function bodies are skipped:
 *   internal `any` is allowed there with a justification comment.
 *
 * Library declarations (`lib.*.d.ts`, `node_modules`) are not searched for their own members; only
 * the type arguments our API passes to them are.
 */
export class NoAnyInPublicApi {
  /**
   * Scans the public API of an entry for `any`.
   *
   * @param options - The entry, tsconfig, allowlist and depth.
   * @returns The findings, the allowed findings and the stale allowlist entries.
   * @throws Error - When the entry cannot be loaded.
   */
  static scan(options: NoAnyOptions): NoAnyReport {
    const entry = isAbsolute(options.entry) ? options.entry : resolve(TsConfig.repoRoot, options.entry);
    const config = TsConfig.load(options.tsconfig);
    const program = ts.createProgram([entry], { ...config.options, noEmit: true });
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(entry);
    if (!sourceFile) throw new Error(`NoAnyInPublicApi: cannot load entry ${entry}`);
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    const exported = moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : [];
    const state: ScanState = {
      program,
      checker,
      maxDepth: options.maxDepth ?? 12,
      findings: new Map(),
      scannedDeclarations: new Set(),
      walkedTargets: new Set(),
    };

    for (const symbol of exported) NoAnyInPublicApi.visitExport(state, symbol);

    const allowlist = options.allowlist ?? [];
    const used = new Set<AnyAllowEntry>();
    const findings: AnyFinding[] = [];
    const allowed: AnyFinding[] = [];
    /* A syntax finding on a line that already has a type finding is the same `any`, seen twice. */
    const typeLines = new Set(
      [...state.findings.values()].filter((f) => f.via === "type").map((f) => `${f.file}:${f.line}`),
    );
    const unique = [...state.findings.values()].filter(
      (f) => f.via === "type" || !typeLines.has(`${f.file}:${f.line}`),
    );
    for (const finding of unique.sort((a, b) => a.path.localeCompare(b.path))) {
      const entryMatch = allowlist.find((allow) =>
        typeof allow.path === "string" ? allow.path === finding.path : allow.path.test(finding.path),
      );
      if (entryMatch) {
        used.add(entryMatch);
        allowed.push(finding);
      } else {
        findings.push(finding);
      }
    }
    return {
      entry: relative(TsConfig.repoRoot, entry),
      exports: exported.map((symbol) => symbol.name).sort(),
      findings,
      allowed,
      unusedAllowEntries: allowlist.filter((allow) => !used.has(allow)),
    };
  }

  /**
   * Human-readable report; empty string when the guard passes.
   *
   * @param report - A scan report.
   * @returns The text.
   */
  static format(report: NoAnyReport): string {
    const lines: string[] = [];
    if (report.findings.length > 0) {
      lines.push(`'any' in the public API of ${report.entry} (${report.findings.length}):`);
      for (const f of report.findings) lines.push(`  ${f.path}  [${f.via}]  ${f.file}:${f.line}  ${f.text}`);
    }
    if (report.unusedAllowEntries.length > 0) {
      lines.push(`stale allowlist entries for ${report.entry} (matched nothing):`);
      for (const allow of report.unusedAllowEntries) lines.push(`  ${String(allow.path)} — ${allow.reason}`);
    }
    return lines.join("\n");
  }

  /**
   * Scans and fails on any finding or stale allowlist entry.
   *
   * @param options - The entry, tsconfig, allowlist and depth.
   * @returns The report when the guard passes.
   * @throws Error - With {@link format}'s text when there are findings or stale allowlist entries.
   */
  static assert(options: NoAnyOptions): NoAnyReport {
    const report = NoAnyInPublicApi.scan(options);
    const text = NoAnyInPublicApi.format(report);
    if (text !== "") throw new Error(text);
    return report;
  }

  /**
   * Scans one export, as a type and as a value.
   *
   * @param state - The scan state.
   * @param exportSymbol - The exported symbol.
   */
  private static visitExport(state: ScanState, exportSymbol: ts.Symbol): void {
    const { checker } = state;
    const symbol = exportSymbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exportSymbol) : exportSymbol;
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (!declaration) return;
    const name = exportSymbol.name;
    for (const decl of symbol.declarations ?? []) NoAnyInPublicApi.scanSyntax(state, decl, name);
    if (symbol.flags & (ts.SymbolFlags.Type | ts.SymbolFlags.Class)) {
      NoAnyInPublicApi.walk(state, checker.getDeclaredTypeOfSymbol(symbol), name, 0, new Set(), declaration);
    }
    if (symbol.flags & ts.SymbolFlags.Value) {
      NoAnyInPublicApi.walk(
        state,
        checker.getTypeOfSymbolAtLocation(symbol, declaration),
        name,
        0,
        new Set(),
        declaration,
      );
    }
  }

  /**
   * Tells whether a node lives in a library declaration.
   *
   * @param state - The scan state.
   * @param node - The node.
   * @returns `true` for default-library and `node_modules` files.
   */
  private static isExternal(state: ScanState, node: ts.Node): boolean {
    const file = node.getSourceFile();
    return (
      state.program.isSourceFileDefaultLibrary(file) ||
      state.program.isSourceFileFromExternalLibrary(file) ||
      file.fileName.includes("/node_modules/")
    );
  }

  /**
   * Stores a finding once per path and place.
   *
   * @param state - The scan state.
   * @param finding - The finding.
   */
  private static record(state: ScanState, finding: AnyFinding): void {
    const key = `${finding.via}|${finding.path}|${finding.file}:${finding.line}`;
    if (!state.findings.has(key)) state.findings.set(key, finding);
  }

  /**
   * File and line of a node.
   *
   * @param node - The node, if known.
   * @returns The repo-relative file and 1-based line, or an unknown marker.
   */
  private static locate(node: ts.Node | undefined): { file: string; line: number } {
    if (!node) return { file: "<unknown>", line: 0 };
    const sourceFile = node.getSourceFile();
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    return { file: relative(TsConfig.repoRoot, sourceFile.fileName), line: line + 1 };
  }

  /**
   * Walks a type recursively and records every `any` it reaches.
   *
   * @param state - The scan state.
   * @param type - The type to walk.
   * @param path - The API path of this position.
   * @param depth - Current nesting depth.
   * @param seen - Types on the current path, used to cut recursion.
   * @param at - The declaration to report the location of.
   */
  private static walk(
    state: ScanState,
    type: ts.Type,
    path: string,
    depth: number,
    seen: Set<ts.Type>,
    at?: ts.Node,
  ): void {
    const { checker } = state;
    if (type.flags & ts.TypeFlags.Any) {
      NoAnyInPublicApi.record(state, {
        path,
        via: "type",
        ...NoAnyInPublicApi.locate(at),
        text: checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation),
      });
      return;
    }
    if (seen.has(type) || depth > state.maxDepth) return;
    const next = new Set(seen).add(type);

    for (const symbol of [type.aliasSymbol, type.symbol]) {
      for (const decl of symbol?.declarations ?? []) NoAnyInPublicApi.scanSyntax(state, decl, path);
    }
    (type.aliasTypeArguments ?? []).forEach((arg, i) => {
      NoAnyInPublicApi.walk(state, arg, `${path}<${i}>`, depth + 1, next, at);
    });

    if (type.isUnionOrIntersection()) {
      for (const member of type.types) NoAnyInPublicApi.walk(state, member, path, depth + 1, next, at);
      return;
    }
    if (type.flags & ts.TypeFlags.TypeParameter) {
      const constraint = (type as ts.TypeParameter).getConstraint();
      if (constraint) NoAnyInPublicApi.walk(state, constraint, `${path}<extends>`, depth + 1, next, at);
      return;
    }
    if (type.flags & ts.TypeFlags.Index) {
      NoAnyInPublicApi.walk(state, (type as ts.IndexType).type, `${path}<keyof>`, depth + 1, next, at);
      return;
    }
    if (type.flags & ts.TypeFlags.IndexedAccess) {
      const indexed = type as ts.IndexedAccessType;
      NoAnyInPublicApi.walk(state, indexed.objectType, path, depth + 1, next, at);
      NoAnyInPublicApi.walk(state, indexed.indexType, `${path}[]`, depth + 1, next, at);
      return;
    }
    if (type.flags & ts.TypeFlags.Conditional) {
      const conditional = type as ts.ConditionalType;
      NoAnyInPublicApi.walk(state, conditional.checkType, `${path}<check>`, depth + 1, next, at);
      NoAnyInPublicApi.walk(state, conditional.extendsType, `${path}<extends>`, depth + 1, next, at);
      return;
    }
    if (!(type.flags & ts.TypeFlags.Object)) return;

    const declaration = type.symbol?.declarations?.[0];
    const external = declaration !== undefined && NoAnyInPublicApi.isExternal(state, declaration);
    const typeArguments =
      (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
        ? checker.getTypeArguments(type as ts.TypeReference)
        : [];
    typeArguments.forEach((arg, i) => {
      NoAnyInPublicApi.walk(state, arg, `${path}<${i}>`, depth + 1, next, at);
    });
    /* A library type's own members are the library's business; only what we pass into it is ours. */
    if (external) return;
    /* An instantiation of one of OUR generic classes/interfaces adds nothing but its type arguments
       (walked above): its members are the generic declaration's, walked ONCE with the type parameters.
       Without this a fluent builder (`find().populate().lean()…`, every method returning another
       instantiation) is walked combinatorially, and the compiler gives up on deep instantiations with
       its error type — which has the `any` flag and was reported as a false finding. */
    const target =
      (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference ? (type as ts.TypeReference).target : undefined;
    if (target !== undefined && target !== type) {
      if (state.walkedTargets.has(target)) return;
      state.walkedTargets.add(target);
      NoAnyInPublicApi.walk(state, target, path, depth + 1, next, at);
      return;
    }
    if (target !== undefined) {
      if (state.walkedTargets.has(target)) return;
      state.walkedTargets.add(target);
    }

    const isClassStatic = (type.symbol?.flags ?? 0) & ts.SymbolFlags.Class && type.getConstructSignatures().length > 0;
    for (const property of checker.getPropertiesOfType(type)) {
      /* `Class.prototype` is the instance type, already walked from the class's declared type. */
      if (isClassStatic && property.name === "prototype") continue;
      const propertyDeclaration = property.valueDeclaration ?? property.declarations?.[0];
      if (propertyDeclaration && NoAnyInPublicApi.isPrivate(propertyDeclaration)) continue;
      const propertyType = checker.getTypeOfSymbol(property);
      NoAnyInPublicApi.walk(
        state,
        propertyType,
        `${path}.${property.name}`,
        depth + 1,
        next,
        propertyDeclaration ?? at,
      );
    }
    const signatures = [
      ...type.getCallSignatures().map((s) => ({ s, prefix: path, construct: false })),
      ...type.getConstructSignatures().map((s) => ({ s, prefix: `new ${path}`, construct: true })),
    ];
    for (const { s, prefix, construct } of signatures) {
      const signatureAt = s.getDeclaration() ?? at;
      for (const typeParameter of s.getTypeParameters() ?? []) {
        NoAnyInPublicApi.walk(
          state,
          typeParameter,
          `${prefix}<${typeParameter.symbol.name}>`,
          depth + 1,
          next,
          signatureAt,
        );
      }
      for (const parameter of s.getParameters()) {
        const parameterType = checker.getTypeOfSymbol(parameter);
        NoAnyInPublicApi.walk(state, parameterType, `${prefix}(${parameter.name})`, depth + 1, next, signatureAt);
      }
      /* A class constructor returns the instance type, which the class's declared type already covers. */
      if (!(construct && isClassStatic)) {
        NoAnyInPublicApi.walk(state, s.getReturnType(), `${prefix}()`, depth + 1, next, signatureAt);
      }
    }
    for (const info of checker.getIndexInfosOfType(type)) {
      const key = checker.typeToString(info.keyType);
      NoAnyInPublicApi.walk(state, info.type, `${path}[${key}]`, depth + 1, next, info.declaration ?? at);
    }
  }

  /**
   * Tells whether a declaration is private (`private` keyword or `#name`).
   *
   * @param node - The declaration.
   * @returns `true` for a private member.
   */
  private static isPrivate(node: ts.Node): boolean {
    const name = (node as ts.NamedDeclaration).name;
    if (name && ts.isPrivateIdentifier(name)) return true;
    return (
      ts.canHaveModifiers(node) &&
      (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Private) !== 0
    );
  }

  /**
   * Finds `any` keywords in the type positions of one of our declarations (not inside bodies or expressions).
   *
   * @param state - The scan state.
   * @param declaration - The declaration to scan.
   * @param path - The API path to report under.
   */
  private static scanSyntax(state: ScanState, declaration: ts.Node, path: string): void {
    if (state.scannedDeclarations.has(declaration) || NoAnyInPublicApi.isExternal(state, declaration)) return;
    state.scannedDeclarations.add(declaration);
    const sourceFile = declaration.getSourceFile();
    const visit = (node: ts.Node): void => {
      if (
        ts.isBlock(node) ||
        ts.isAsExpression(node) ||
        ts.isTypeAssertionExpression(node) ||
        ts.isSatisfiesExpression(node)
      ) {
        return;
      }
      if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
        /* Parameters and the return annotation are API; the expression body is implementation. */
        for (const child of [...(node.typeParameters ?? []), ...node.parameters]) visit(child);
        if (node.type) visit(node.type);
        return;
      }
      if (ts.isPropertyDeclaration(node) && NoAnyInPublicApi.isPrivate(node)) return;
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        const owner = NoAnyInPublicApi.ownerText(node, declaration, sourceFile);
        NoAnyInPublicApi.record(state, {
          path,
          via: "syntax",
          ...NoAnyInPublicApi.locate(node),
          text: owner,
        });
        return;
      }
      /* Follow references into our own helper declarations (`type Exposed<T> = Hidden<T>`). */
      if (ts.isTypeReferenceNode(node) || ts.isExpressionWithTypeArguments(node) || ts.isTypeQueryNode(node)) {
        const nameNode = ts.isTypeReferenceNode(node)
          ? node.typeName
          : ts.isTypeQueryNode(node)
            ? node.exprName
            : node.expression;
        const referenced = state.checker.getSymbolAtLocation(nameNode);
        const target =
          referenced && referenced.flags & ts.SymbolFlags.Alias
            ? state.checker.getAliasedSymbol(referenced)
            : referenced;
        for (const decl of target?.declarations ?? []) NoAnyInPublicApi.scanSyntax(state, decl, path);
      }
      ts.forEachChild(node, visit);
    };
    visit(declaration);
  }

  /**
   * The smallest enclosing member/parameter text around an `any` keyword, trimmed to one line.
   *
   * @param node - The `any` keyword node.
   * @param declaration - The declaration being scanned; the search stops there.
   * @param sourceFile - The file that contains the node.
   * @returns The text, at most 160 characters.
   */
  private static ownerText(node: ts.Node, declaration: ts.Node, sourceFile: ts.SourceFile): string {
    let owner: ts.Node = node;
    while (
      owner.parent &&
      owner !== declaration &&
      !ts.isParameter(owner) &&
      !ts.isPropertySignature(owner) &&
      !ts.isPropertyDeclaration(owner) &&
      !ts.isTypeAliasDeclaration(owner)
    ) {
      owner = owner.parent;
    }
    const text = owner.getText(sourceFile).replace(/\s+/g, " ");
    return text.length > 160 ? `${text.slice(0, 157)}...` : text;
  }
}
