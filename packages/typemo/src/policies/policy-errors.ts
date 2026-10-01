import { StrictModeError, type StrictModeReason } from "../errors/strict-mode-error.ts";

/**
 * The strictness rules the strict policies enforce (a subset of `StrictModeReason`).
 *
 * @example
 * ```ts
 * const rule: StrictRule = "empty-filter";
 * ```
 */
export type StrictRule = Extract<
  StrictModeReason,
  | "unknown-path"
  | "not-hidden"
  | "undefined"
  | "empty-filter"
  | "empty-logical"
  | "empty-update"
  | "immutable"
  | "limit"
  | "sanitize"
>;

/** The ONE place where the policies and the codecs create their errors. */
export class PolicyErrors {
  /**
   * Creates the error of a strict-mode rule.
   *
   * @param rule - The rule that was broken.
   * @param message - What went wrong and how to fix it.
   * @param path - The offending path, when there is one.
   * @returns The error, ready to throw.
   */
  static strict(rule: StrictRule, message: string, path?: string): StrictModeError {
    return new StrictModeError(rule, message, path === undefined ? {} : { path });
  }
}
