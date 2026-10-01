/*
 * The "decorators package" contract. The shared suite runs the same scenarios once with the
 * legacy decorators of the core and once with the TC39 package; both must export these names and compile the
 * same models into the same `describe()` JSON.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** The names every decorators package exports (the option types are the core's). */
export const DECORATOR_NAMES = [
  "Schema",
  "Prop",
  "Virtual",
  "Index",
  "Pre",
  "Post",
  "PostError",
  "Plugin",
  "Discriminator",
] as const;

/**
 * One name of the decorator contract.
 *
 * @example
 * ```ts
 * const name: DecoratorName = "Schema";
 * ```
 */
export type DecoratorName = (typeof DECORATOR_NAMES)[number];

/**
 * Which decorator mode a runner compiles with.
 *
 * @example
 * ```ts
 * const mode: DecoratorMode = "tc39";
 * ```
 */
export type DecoratorMode = "legacy" | "tc39";

/** Checks that a decorators package fulfils the shared contract. */
export class DecoratorContract {
  /**
   * Names of the contract the module does not export as functions.
   *
   * @param module - The module namespace of a decorators package.
   * @returns The missing names; empty when the contract is fulfilled.
   */
  static missing(module: Readonly<Record<string, unknown>>): DecoratorName[] {
    return DECORATOR_NAMES.filter((name) => typeof module[name] !== "function");
  }

  /**
   * The mode the running transpiler applied, read from how a probe decorator was called.
   *
   * @param probeArgs - The arguments the probe decorator received.
   * @returns `tc39` when a context object was passed, otherwise `legacy`.
   */
  static detectMode(probeArgs: readonly unknown[]): DecoratorMode {
    /* TC39 class decorators get (value, context) with a context object that has `kind`; legacy ones get (target). */
    const context = probeArgs[1];
    return typeof context === "object" && context !== null && "kind" in context ? "tc39" : "legacy";
  }

  /**
   * Compares `actual` with the golden JSON file; `update` (the legacy runner under TYPEMO_UPDATE_GOLDEN=1)
   * rewrites it. JSON round-trip on purpose: `describe()` is a JSON description, both modes must agree on it.
   *
   * @param file - Path of the golden file; created when missing.
   * @param actual - The value produced by the run.
   * @param update - Rewrite the golden file from `actual`.
   * @returns The stored and the normalized values, for comparison by the caller.
   */
  static golden(
    file: string,
    actual: unknown,
    update: boolean,
  ): { readonly expected: unknown; readonly actual: unknown } {
    const normalized: unknown = JSON.parse(JSON.stringify(actual));
    if (update || !existsSync(file)) writeFileSync(file, `${JSON.stringify(normalized, null, 2)}\n`);
    return { expected: JSON.parse(readFileSync(file, "utf8")) as unknown, actual: normalized };
  }
}
