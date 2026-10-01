import { dirname, resolve } from "node:path";
import ts from "typescript";

/**
 * Compiler options parsed from a tsconfig, plus where it lives.
 *
 * @example
 * ```ts
 * const config: LoadedTsConfig = TsConfig.load();
 * ```
 */
export interface LoadedTsConfig {
  /** Absolute path of the tsconfig. */
  readonly path: string;
  /** The parsed compiler options. */
  readonly options: ts.CompilerOptions;
  /** The files the tsconfig includes. */
  readonly fileNames: readonly string[];
}

/**
 * Loads tsconfig files the way `tsc -p` does (`extends`, `paths`, `types`), for the type-test
 * runner, the probe and the `any` guard. Everything is resolved from the repository root so
 * the tools behave the same whatever directory `bun test` was started from.
 */
export class TsConfig {
  /** Repository root: `packages/test-kit/src/types` is four levels below it. */
  static readonly repoRoot: string = resolve(import.meta.dir, "../../../..");

  /** `tsconfig.test.json`: legacy decorators on, `paths` to every workspace package's sources. */
  static readonly testConfigPath: string = resolve(TsConfig.repoRoot, "tsconfig.test.json");

  /** Parsed configs by absolute path. */
  private static readonly cache = new Map<string, LoadedTsConfig>();

  /**
   * Parses a tsconfig (cached per absolute path).
   *
   * @param configPath - Path of the tsconfig; defaults to `tsconfig.test.json`.
   * @returns The parsed options and file list.
   * @throws Error - With the formatted diagnostics if the tsconfig is invalid.
   */
  static load(configPath: string = TsConfig.testConfigPath): LoadedTsConfig {
    const absolute = resolve(configPath);
    const cached = TsConfig.cache.get(absolute);
    if (cached) return cached;
    const read = ts.readConfigFile(absolute, ts.sys.readFile);
    if (read.error) throw new Error(TsConfig.formatDiagnostics([read.error]));
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(absolute), undefined, absolute);
    /* "No inputs were found" (TS18003) is irrelevant when only the options are needed. */
    const errors = parsed.errors.filter((d) => d.code !== 18003);
    if (errors.length > 0) throw new Error(TsConfig.formatDiagnostics(errors));
    const loaded: LoadedTsConfig = { path: absolute, options: parsed.options, fileNames: parsed.fileNames };
    TsConfig.cache.set(absolute, loaded);
    return loaded;
  }

  /**
   * `file(line,col): error TSxxxx: message` lines, message chains flattened, no colors.
   *
   * @param diagnostics - The diagnostics to format.
   * @returns The text.
   */
  static formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
    return ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => TsConfig.repoRoot,
      getNewLine: () => "\n",
    });
  }
}
