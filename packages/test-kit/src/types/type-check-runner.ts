import { isAbsolute, relative, resolve } from "node:path";
import ts from "typescript";
import { TsConfig } from "./ts-config.ts";

/**
 * What to type-check. Defaults: the files and options of `tsconfig.test.json`.
 *
 * @example
 * ```ts
 * const options: TypeCheckOptions = { files: ["packages/typemo/test/types/**\/*.ts"] };
 * ```
 */
export interface TypeCheckOptions {
  /** tsconfig to take compiler options (and, without `files`, root files) from. */
  readonly tsconfig?: string;
  /**
   * Root files instead of the tsconfig's own: absolute paths, repo-relative paths or
   * globs (`packages/x/test/types/**\/*.ts`).
   */
  readonly files?: readonly string[];
  /** In-memory files added as roots (absolute or repo-relative path → source). They shadow disk files. */
  readonly sources?: Readonly<Record<string, string>>;
  /** Option overrides on top of the tsconfig (`noEmit` is always forced). */
  readonly compilerOptions?: ts.CompilerOptions;
}

/**
 * One compiler diagnostic, flattened for assertions and printing.
 *
 * @example
 * ```ts
 * const [first]: readonly TypeDiagnostic[] = TypeCheckRunner.run().diagnostics;
 * ```
 */
export interface TypeDiagnostic {
  /** Repo-relative file, or `undefined` for a global diagnostic. */
  readonly file: string | undefined;
  /** 1-based line, when the diagnostic has a location. */
  readonly line: number | undefined;
  /** 1-based column, when the diagnostic has a location. */
  readonly column: number | undefined;
  /** The TypeScript error number. */
  readonly code: number;
  /** The message with chains flattened. */
  readonly message: string;
}

/**
 * The outcome of `TypeCheckRunner.run`.
 *
 * @example
 * ```ts
 * const result: TypeCheckResult = TypeCheckRunner.run();
 * expect(result.ok).toBe(true);
 * ```
 */
export interface TypeCheckResult {
  /** `true` when there are no diagnostics. */
  readonly ok: boolean;
  /** Every diagnostic. */
  readonly diagnostics: readonly TypeDiagnostic[];
  /** `tsc`-style text of every diagnostic (empty when `ok`). */
  readonly text: string;
  /** The files that were checked, repo-relative. */
  readonly rootFiles: readonly string[];
  /** Check time in milliseconds. */
  readonly durationMs: number;
}

/**
 * Runs the compiler programmatically over type tests, so a broken type test fails a
 * `bun test` run with the same diagnostics `bun run test:types` prints.
 */
export class TypeCheckRunner {
  /**
   * Type-checks and returns every pre-emit diagnostic. Never throws for type errors.
   *
   * @param options - What to check.
   * @returns The diagnostics and timing.
   */
  static run(options: TypeCheckOptions = {}): TypeCheckResult {
    const started = performance.now();
    const config = TsConfig.load(options.tsconfig);
    const compilerOptions: ts.CompilerOptions = { ...config.options, ...options.compilerOptions, noEmit: true };
    const sources = TypeCheckRunner.absoluteSources(options.sources ?? {});
    const listed = options.files ? TypeCheckRunner.expandFiles(options.files) : [...config.fileNames];
    const rootFiles = [...new Set([...listed, ...sources.keys()])];

    const host = ts.createCompilerHost(compilerOptions, true);
    const baseGetSourceFile = host.getSourceFile.bind(host);
    const baseFileExists = host.fileExists.bind(host);
    const baseReadFile = host.readFile.bind(host);
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
      const text = sources.get(resolve(fileName));
      return text === undefined
        ? baseGetSourceFile(fileName, languageVersion, onError, shouldCreate)
        : ts.createSourceFile(fileName, text, languageVersion, true);
    };
    host.fileExists = (fileName) => sources.has(resolve(fileName)) || baseFileExists(fileName);
    host.readFile = (fileName) => sources.get(resolve(fileName)) ?? baseReadFile(fileName);

    const program = ts.createProgram({ rootNames: rootFiles, options: compilerOptions, host });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    return {
      ok: diagnostics.length === 0,
      diagnostics: diagnostics.map(TypeCheckRunner.toTypeDiagnostic),
      text: diagnostics.length === 0 ? "" : TsConfig.formatDiagnostics(diagnostics),
      rootFiles: rootFiles.map(TypeCheckRunner.repoRelative),
      durationMs: performance.now() - started,
    };
  }

  /**
   * Type-checks and fails on any diagnostic.
   *
   * @param options - What to check.
   * @returns The clean result.
   * @throws Error - With the full diagnostic text when anything fails to type-check.
   */
  static assertClean(options: TypeCheckOptions = {}): TypeCheckResult {
    const result = TypeCheckRunner.run(options);
    if (!result.ok) {
      throw new Error(`type check failed with ${result.diagnostics.length} diagnostic(s):\n${result.text}`);
    }
    return result;
  }

  /**
   * Flattens a compiler diagnostic.
   *
   * @param diagnostic - The compiler diagnostic.
   * @returns The flattened form.
   */
  static toTypeDiagnostic(diagnostic: ts.Diagnostic): TypeDiagnostic {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    if (!diagnostic.file || diagnostic.start === undefined) {
      return { file: undefined, line: undefined, column: undefined, code: diagnostic.code, message };
    }
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    return {
      file: TypeCheckRunner.repoRelative(diagnostic.file.fileName),
      line: line + 1,
      column: character + 1,
      code: diagnostic.code,
      message,
    };
  }

  /**
   * Makes a path relative to the repo root.
   *
   * @param fileName - An absolute path.
   * @returns The repo-relative path.
   */
  private static repoRelative(fileName: string): string {
    return relative(TsConfig.repoRoot, fileName);
  }

  /**
   * Makes a path absolute, resolving against the repo root.
   *
   * @param fileName - An absolute or repo-relative path.
   * @returns The absolute path.
   */
  private static absolute(fileName: string): string {
    return isAbsolute(fileName) ? fileName : resolve(TsConfig.repoRoot, fileName);
  }

  /**
   * Normalizes the keys of the in-memory sources to absolute paths.
   *
   * @param sources - Path to source text.
   * @returns The same sources keyed by absolute path.
   */
  private static absoluteSources(sources: Readonly<Record<string, string>>): Map<string, string> {
    return new Map(Object.entries(sources).map(([fileName, text]) => [TypeCheckRunner.absolute(fileName), text]));
  }

  /**
   * Expands globs in a file list.
   *
   * @param files - Absolute paths, repo-relative paths or globs.
   * @returns Absolute file paths.
   */
  private static expandFiles(files: readonly string[]): string[] {
    return files.flatMap((file) => {
      if (!/[*?[{]/.test(file)) return [TypeCheckRunner.absolute(file)];
      const glob = new Bun.Glob(file);
      return [...glob.scanSync({ cwd: TsConfig.repoRoot, absolute: true })].sort();
    });
  }
}
