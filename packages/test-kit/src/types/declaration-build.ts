import { rmSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { TsConfig } from "./ts-config.ts";

/**
 * The result of building a package's declarations.
 *
 * @example
 * ```ts
 * const result: DeclarationBuildResult = DeclarationBuild.build("packages/typemo", outDir);
 * ```
 */
export interface DeclarationBuildResult {
  /** The emitted entry declaration (`<outDir>/index.d.ts`). */
  readonly index: string;
  /** The directory the declarations were written to. */
  readonly outDir: string;
  /** Diagnostics of the build (empty when it succeeded). */
  readonly text: string;
  /** `true` when the build had no diagnostics and emitted. */
  readonly ok: boolean;
  /** Build time in milliseconds. */
  readonly durationMs: number;
}

/**
 * Builds the `.d.ts` of a workspace package the way it is published — its own tsconfig, declarations only — so
 * that tests can compile a CONSUMER against them instead of the sources (the repository's type tests
 * resolve `@venloc/typemo` to its sources and can miss bugs that only the emitted declarations have).
 * `outDir` should be inside the package's `node_modules` so that the declarations resolve `mongodb`/`bson` like an
 * installed package does.
 */
export class DeclarationBuild {
  /**
   * Emits the declarations of a package.
   *
   * @param packageDir - The package directory, absolute or relative to the repo root.
   * @param outDir - Where to write the declarations; it is deleted first.
   * @returns The entry file, the diagnostics and the duration.
   */
  static build(packageDir: string, outDir: string): DeclarationBuildResult {
    const started = performance.now();
    const root = resolve(TsConfig.repoRoot, packageDir);
    const config = TsConfig.load(resolve(root, "tsconfig.json"));
    rmSync(outDir, { recursive: true, force: true });
    const {
      composite: _composite,
      incremental: _incremental,
      tsBuildInfoFile: _info,
      declarationMap: _map,
      sourceMap: _source,
      ...options
    } = config.options;
    const program = ts.createProgram({
      rootNames: config.fileNames.filter((file) => !file.endsWith(".test.ts")),
      options: {
        ...options,
        declaration: true,
        emitDeclarationOnly: true,
        noEmit: false,
        outDir,
        rootDir: resolve(root, "src"),
        typeRoots: [resolve(TsConfig.repoRoot, "node_modules/@types")],
      },
    });
    const emitted = program.emit();
    const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics];
    return {
      index: resolve(outDir, "index.d.ts"),
      outDir,
      text: diagnostics.length === 0 ? "" : TsConfig.formatDiagnostics(diagnostics),
      ok: diagnostics.length === 0 && !emitted.emitSkipped,
      durationMs: performance.now() - started,
    };
  }
}
