import { isAbsolute, resolve } from "node:path";
import ts from "typescript";
import { TsConfig } from "../types/ts-config.ts";

/*
 * The public export list of an entry, as the compiler sees it (values and types, with
 * `export *` resolved). A snapshot of it makes every change of the public API visible in a diff.
 */

/**
 * Options of `PublicExports.list`.
 *
 * @example
 * ```ts
 * const options: PublicExportsOptions = { entry: "packages/typemo/src/index.ts" };
 * ```
 */
export interface PublicExportsOptions {
  /** The entry file, absolute or relative to the repo root. */
  readonly entry: string;
  /** tsconfig for compiler options; defaults to `tsconfig.test.json`. */
  readonly tsconfig?: string;
}

/** The public export list of an entry file. */
export class PublicExports {
  /**
   * Sorted lines `value Name` / `type Name` (a name that is both a value and a type is `value`).
   *
   * @param options - The entry file and optional tsconfig.
   * @returns One line per public export.
   * @throws Error - When the entry is not in the program or is not a module.
   */
  static list(options: PublicExportsOptions): string[] {
    const entry = isAbsolute(options.entry) ? options.entry : resolve(TsConfig.repoRoot, options.entry);
    const config = TsConfig.load(options.tsconfig);
    const program = ts.createProgram([entry], { ...config.options, noEmit: true });
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(entry);
    if (source === undefined) throw new Error(`PublicExports: ${entry} is not in the program`);
    const moduleSymbol = checker.getSymbolAtLocation(source);
    if (moduleSymbol === undefined) throw new Error(`PublicExports: ${entry} is not a module`);
    return checker
      .getExportsOfModule(moduleSymbol)
      .map((symbol) => `${PublicExports.isValue(checker, symbol) ? "value" : "type"} ${symbol.getName()}`)
      .sort((a, b) => (a.slice(a.indexOf(" ")) < b.slice(b.indexOf(" ")) ? -1 : 1));
  }

  /**
   * Tells whether an exported symbol can be used as a value.
   *
   * @param checker - The program's type checker.
   * @param symbol - The exported symbol.
   * @returns `true` for a value export, `false` for a type-only one.
   */
  static isValue(checker: ts.TypeChecker, symbol: ts.Symbol): boolean {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    if ((target.flags & ts.SymbolFlags.Value) === 0) return false;
    /* `export type { Foo }` of a class: the alias chain is type-only, so a user cannot use it as a value. */
    const declarations = symbol.declarations ?? [];
    return !declarations.some((declaration) => ts.isTypeOnlyImportOrExportDeclaration(declaration));
  }
}
