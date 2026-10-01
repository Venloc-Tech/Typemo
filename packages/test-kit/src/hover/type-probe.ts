import { isAbsolute, resolve } from "node:path";
import ts from "typescript";
import { TsConfig } from "../types/ts-config.ts";
import { TypeCheckRunner, type TypeDiagnostic } from "../types/type-check-runner.ts";
import { type HoverMarker, HoverText } from "./hover-text.ts";

/**
 * Options of `TypeProbe`.
 *
 * @example
 * ```ts
 * const options: TypeProbeOptions = { compilerOptions: { strict: true } };
 * ```
 */
export interface TypeProbeOptions {
  /** tsconfig for compiler options (default `tsconfig.test.json`: legacy decorators, workspace `paths`). */
  readonly tsconfig?: string;
  /** Overrides on top of the tsconfig. */
  readonly compilerOptions?: ts.CompilerOptions;
}

/**
 * Options of `TypeProbe.check`.
 *
 * @example
 * ```ts
 * const options: ProbeCheckOptions = { dir: import.meta.dir };
 * ```
 */
export interface ProbeCheckOptions {
  /**
   * Directory the virtual file pretends to live in: relative imports and `node_modules` lookups
   * start there. Default: the test-kit package (sees `mongodb`, `bson` and the workspace packages).
   * Pass `import.meta.dir` to import fixtures next to a test.
   */
  readonly dir?: string;
}

/**
 * Printing flags for {@link ProbeSource.typeOf}: full text (`NoTruncation`), the body of a queried alias
 * instead of its name (`InTypeAlias`), and library aliases by name without an `import("...")` prefix.
 */
export const PROBE_TYPE_FORMAT: ts.TypeFormatFlags =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.InTypeAlias |
  ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;

/**
 * What a probe resolved a type query to, for tools that need the compiler objects (the shape harness).
 *
 * @example
 * ```ts
 * source.queryType("string", ({ type, checker }: ProbeTypeQuery) => checker.typeToString(type));
 * ```
 */
export interface ProbeTypeQuery {
  /** The resolved type. */
  readonly type: ts.Type;
  /** The node the type was read from. */
  readonly node: ts.Node;
  /** The checker that owns the type. */
  readonly checker: ts.TypeChecker;
}

/** Virtual file text plus its version, as the language service host sees it. */
interface VirtualFile {
  /** The current source text. */
  text: string;
  /** Bumped whenever the text changes. */
  version: number;
}

/**
 * Hover tests over the TypeScript language service: code snippets become virtual
 * files next to real ones, and the IDE's quick info, types and diagnostics are read from them.
 *
 * One language service per tsconfig is shared across the whole `bun test` process
 * ({@link TypeProbe.shared}); each directory gets a single virtual "slot" file whose text is
 * swapped per query, so the program structure is reused and a warm query only rechecks one file.
 * Disk files are read once and cached for the run (tests do not edit sources while running).
 */
export class TypeProbe {
  /** Shared probes by tsconfig and compiler options. */
  private static readonly instances = new Map<string, TypeProbe>();

  /**
   * The process-wide probe for these options (created on first use).
   *
   * @param options - The tsconfig and compiler-option overrides.
   * @returns The shared probe.
   */
  static shared(options: TypeProbeOptions = {}): TypeProbe {
    const key = JSON.stringify({
      tsconfig: resolve(options.tsconfig ?? TsConfig.testConfigPath),
      o: options.compilerOptions ?? {},
    });
    let probe = TypeProbe.instances.get(key);
    if (!probe) {
      probe = new TypeProbe(options);
      TypeProbe.instances.set(key, probe);
    }
    return probe;
  }

  /** Default directory of the virtual file: the test-kit package root. */
  static readonly defaultDir: string = resolve(TsConfig.repoRoot, "packages/test-kit");

  /** The compiler options every snippet is checked with. */
  readonly compilerOptions: ts.CompilerOptions;
  /** The language service. */
  private readonly service: ts.LanguageService;
  /** Virtual files by absolute name. */
  private readonly virtualFiles = new Map<string, VirtualFile>();
  /** Disk files read so far (`undefined` for a missing file). */
  private readonly diskSnapshots = new Map<string, ts.IScriptSnapshot | undefined>();
  /** Bumped whenever a virtual file changes, so the service re-checks. */
  private projectVersion = 0;
  /** Queries answered so far. */
  private queryCount = 0;

  /**
   * @param options - The tsconfig and compiler-option overrides.
   */
  constructor(options: TypeProbeOptions = {}) {
    const config = TsConfig.load(options.tsconfig);
    this.compilerOptions = {
      ...config.options,
      ...options.compilerOptions,
      noEmit: true,
      /* Full types in error messages, as `expectTypeError` needs to match on them. */
      noErrorTruncation: true,
    };
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => this.compilerOptions,
      getProjectVersion: () => String(this.projectVersion),
      getScriptFileNames: () => [...this.virtualFiles.keys()],
      getScriptVersion: (fileName) => String(this.virtualFiles.get(fileName)?.version ?? 0),
      getScriptSnapshot: (fileName) => this.snapshot(fileName),
      getCurrentDirectory: () => TsConfig.repoRoot,
      getDefaultLibFileName: (compilerOptions) => ts.getDefaultLibFilePath(compilerOptions),
      fileExists: (fileName) => this.virtualFiles.has(fileName) || ts.sys.fileExists(fileName),
      readFile: (fileName) => this.virtualFiles.get(fileName)?.text ?? ts.sys.readFile(fileName),
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
      realpath: ts.sys.realpath ?? ((path: string) => path),
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    };
    this.service = ts.createLanguageService(host, ts.createDocumentRegistry());
  }

  /** Number of queries answered so far (for timing reports). */
  get queries(): number {
    return this.queryCount;
  }

  /**
   * Wraps a snippet. Nothing is compiled until the first question is asked.
   *
   * @param code - The snippet.
   * @param options - Where the virtual file pretends to live.
   * @returns The snippet handle.
   */
  check(code: string, options: ProbeCheckOptions = {}): ProbeSource {
    const dir = options.dir ?? TypeProbe.defaultDir;
    const fileName = resolve(isAbsolute(dir) ? dir : resolve(TsConfig.repoRoot, dir), "__type-probe__.ts");
    return new ProbeSource(this, fileName, code);
  }

  /**
   * Puts `text` into the slot file (no-op when it is already there) and returns the language service.
   *
   * @param fileName - Absolute name of the slot file.
   * @param text - The snippet text.
   * @returns The language service, ready to answer about that file.
   */
  activate(fileName: string, text: string): ts.LanguageService {
    this.queryCount++;
    const current = this.virtualFiles.get(fileName);
    if (current?.text !== text) {
      this.virtualFiles.set(fileName, { text, version: (current?.version ?? 0) + 1 });
      this.projectVersion++;
    }
    return this.service;
  }

  /**
   * Script snapshot of a virtual or disk file.
   *
   * @param fileName - Absolute file name.
   * @returns The snapshot, or `undefined` when the file does not exist.
   */
  private snapshot(fileName: string): ts.IScriptSnapshot | undefined {
    const virtual = this.virtualFiles.get(fileName);
    if (virtual) return ts.ScriptSnapshot.fromString(virtual.text);
    if (!this.diskSnapshots.has(fileName)) {
      const text = ts.sys.readFile(fileName);
      this.diskSnapshots.set(fileName, text === undefined ? undefined : ts.ScriptSnapshot.fromString(text));
    }
    return this.diskSnapshots.get(fileName);
  }
}

/**
 * One snippet under test. Every method (re)activates the snippet in the probe's slot, so results
 * stay correct even when other snippets were queried in between.
 */
export class ProbeSource {
  /**
   * @param probe - The probe that owns the language service.
   * @param fileName - Absolute name of the virtual slot file.
   * @param code - The snippet text.
   */
  constructor(
    readonly probe: TypeProbe,
    readonly fileName: string,
    readonly code: string,
  ) {}

  /** Every `// ^?` marker of the snippet. */
  get markers(): HoverMarker[] {
    return HoverText.markers(this.code);
  }

  /**
   * Raw quick info (what the IDE shows on hover) at a source offset, or `undefined` if there is none.
   *
   * @param position - Offset in the snippet.
   * @returns The display text, or `undefined`.
   */
  quickInfoAt(position: number): string | undefined {
    const service = this.probe.activate(this.fileName, this.code);
    /* The third argument is the maximum length of the printed type: no truncation in tests. */
    const info = service.getQuickInfoAtPosition(this.fileName, position, Number.MAX_SAFE_INTEGER);
    return info ? ts.displayPartsToString(info.displayParts) : undefined;
  }

  /**
   * Normalized quick info at a marker: `hover()` for the only marker, `hover(n)` for the n-th
   * (0-based). Whitespace is collapsed ({@link HoverText.normalize}).
   *
   * @param marker - Index of the marker; may be omitted when the snippet has exactly one.
   * @returns The normalized hover text.
   * @throws Error - When there is no such marker, the choice is ambiguous, or the compiler has no info there.
   */
  hover(marker?: number): string {
    const markers = this.markers;
    if (markers.length === 0) throw new Error("ProbeSource.hover: the snippet has no `// ^?` marker");
    if (marker === undefined && markers.length > 1) {
      throw new Error(`ProbeSource.hover: the snippet has ${markers.length} markers; pass the marker index`);
    }
    const target = markers[marker ?? 0];
    if (!target) throw new Error(`ProbeSource.hover: no marker #${marker} (have ${markers.length})`);
    const text = this.quickInfoAt(target.position);
    if (text === undefined) {
      throw new Error(`ProbeSource.hover: no quick info at line ${target.line}, column ${target.column}`);
    }
    return HoverText.normalize(text);
  }

  /**
   * Normalized quick info of every marker, in source order.
   *
   * @returns One hover text per marker.
   */
  hovers(): string[] {
    return this.markers.map((marker) => this.hover(marker.index));
  }

  /**
   * The type of an expression evaluated at the end of the snippet (it may use the snippet's
   * declarations), printed with `NoTruncation | InTypeAlias` unless other flags are given.
   *
   * @param expression - A TypeScript expression.
   * @param flags - Printing flags.
   * @returns The printed type.
   * @throws Error - When the text is not an expression.
   */
  typeOf(expression: string, flags: ts.TypeFormatFlags = PROBE_TYPE_FORMAT): string {
    return this.queryExpression(expression, ({ type, node, checker }) => checker.typeToString(type, node, flags));
  }

  /**
   * A type expression (`Pick<User, "name">`) resolved and printed in full (the alias is expanded).
   *
   * @param typeText - A TypeScript type expression.
   * @param flags - Printing flags.
   * @returns The printed type.
   * @throws Error - When the text is not a type.
   */
  expandType(typeText: string, flags: ts.TypeFormatFlags = PROBE_TYPE_FORMAT): string {
    return this.queryType(typeText, ({ type, node, checker }) => checker.typeToString(type, node, flags));
  }

  /**
   * Runs `use` with the checker and the type of `expression` (evaluated after the snippet).
   *
   * @param expression - A TypeScript expression.
   * @param use - Receives the compiler objects.
   * @returns What `use` returns.
   * @throws Error - When the text is not an expression.
   */
  queryExpression<R>(expression: string, use: (query: ProbeTypeQuery) => R): R {
    const text = `${this.code}\n;(${expression});\n`;
    return this.withLastStatement(text, (statement, checker) => {
      if (!ts.isExpressionStatement(statement) || !ts.isParenthesizedExpression(statement.expression)) {
        throw new Error(`ProbeSource.typeOf: could not parse \`${expression}\` as an expression`);
      }
      const node = statement.expression.expression;
      return use({ type: checker.getTypeAtLocation(node), node, checker });
    });
  }

  /**
   * Runs `use` with the checker and the type named by `typeText` (resolved after the snippet).
   *
   * @param typeText - A TypeScript type expression.
   * @param use - Receives the compiler objects.
   * @returns What `use` returns.
   * @throws Error - When the text is not a type.
   */
  queryType<R>(typeText: string, use: (query: ProbeTypeQuery) => R): R {
    const text = `${this.code}\ntype __TypeProbeTarget__ = ${typeText};\n`;
    return this.withLastStatement(text, (statement, checker) => {
      if (!ts.isTypeAliasDeclaration(statement)) {
        throw new Error(`ProbeSource.expandType: could not parse \`${typeText}\` as a type`);
      }
      return use({ type: checker.getTypeAtLocation(statement.type), node: statement.type, checker });
    });
  }

  /**
   * Runs `use` with the checker and the type of the expression under a `// ^?` marker.
   *
   * @param marker - Index of the marker.
   * @param use - Receives the compiler objects.
   * @returns What `use` returns.
   * @throws Error - When the marker does not exist or points at nothing.
   */
  queryMarker<R>(marker: number, use: (query: ProbeTypeQuery) => R): R {
    const target = this.markers[marker];
    if (!target) throw new Error(`ProbeSource: no marker #${marker}`);
    const { sourceFile, checker } = this.program(this.code);
    const token = ProbeSource.tokenAt(sourceFile, target.position);
    if (!token) throw new Error(`ProbeSource: nothing at line ${target.line}, column ${target.column}`);
    return use({ type: checker.getTypeAtLocation(token), node: token, checker });
  }

  /**
   * Syntactic and semantic diagnostics of the snippet, flattened.
   *
   * @returns The diagnostics; the file is reported as `<snippet>`.
   */
  diagnostics(): TypeDiagnostic[] {
    const service = this.probe.activate(this.fileName, this.code);
    return [...service.getSyntacticDiagnostics(this.fileName), ...service.getSemanticDiagnostics(this.fileName)].map(
      (diagnostic) => {
        const flattened = TypeCheckRunner.toTypeDiagnostic(diagnostic);
        /* The slot file is virtual; name it after the snippet rather than a path that does not exist. */
        return { ...flattened, file: flattened.file === undefined ? undefined : "<snippet>" };
      },
    );
  }

  /**
   * `TSxxxx (line:col): message` for each diagnostic (for readable failure output).
   *
   * @returns One line per diagnostic; empty when there are none.
   */
  diagnosticText(): string {
    return this.diagnostics()
      .map((d) => `TS${d.code} (${d.line ?? "?"}:${d.column ?? "?"}): ${d.message}`)
      .join("\n");
  }

  /**
   * The program and checker after activating `text`.
   *
   * @param text - The full slot text.
   * @returns The source file and the checker.
   * @throws Error - When the probe lost its virtual file.
   */
  private program(text: string): { sourceFile: ts.SourceFile; checker: ts.TypeChecker } {
    const service = this.probe.activate(this.fileName, text);
    const program = service.getProgram();
    const sourceFile = program?.getSourceFile(this.fileName);
    if (!program || !sourceFile) throw new Error(`ProbeSource: the probe lost its virtual file ${this.fileName}`);
    return { sourceFile, checker: program.getTypeChecker() };
  }

  /**
   * Runs `use` on the last statement of the activated text.
   *
   * @param text - The full slot text; its last statement is the one that is inspected.
   * @param use - Receives that statement and the checker.
   * @returns What `use` returns.
   * @throws Error - When the text has no statements.
   */
  private withLastStatement<R>(text: string, use: (statement: ts.Statement, checker: ts.TypeChecker) => R): R {
    const { sourceFile, checker } = this.program(text);
    const statement = sourceFile.statements.at(-1);
    if (!statement) throw new Error("ProbeSource: empty snippet");
    return use(statement, checker);
  }

  /**
   * The innermost node whose span covers `position` (the identifier/token the caret points at).
   *
   * @param sourceFile - The parsed snippet.
   * @param position - Offset in the snippet.
   * @returns The node, or `undefined` when nothing covers the position.
   */
  private static tokenAt(sourceFile: ts.SourceFile, position: number): ts.Node | undefined {
    const find = (node: ts.Node): ts.Node | undefined => {
      if (position < node.getStart(sourceFile) || position >= node.getEnd()) return undefined;
      return ts.forEachChild(node, find) ?? node;
    };
    return ts.forEachChild(sourceFile, find);
  }
}
