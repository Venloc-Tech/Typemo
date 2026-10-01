import { ExprNodes } from "../expr-node.ts";
import type { Arg, Nullable, PropagateNull } from "../expr-types.ts";
import { type Expr, OperatorFactory as F } from "../operator-factory.ts";

/*
 * String operators. `null` behaviour is per operator, as on the server: `$toUpper`/`$substr*` turn
 * `null` into `""`, `$concat`/`$split`/`$trim` return `null`, `$strLenCP` fails on `null` (so it does
 * not accept a nullable argument at all).
 */

/**
 * One `$regexFind` / `$regexFindAll` match.
 *
 * @example
 * ```ts
 * const match: RegexMatch = { match: "ab", idx: 3, captures: ["b", null] };
 * ```
 */
export interface RegexMatch {
  /** The matched text. */
  match: string;
  /** The code point index of the match in the input. */
  idx: number;
  /** The captured groups; `null` for a group that did not take part in the match. */
  captures: (string | null)[];
}

/**
 * The spec of `$regexFind`, `$regexFindAll` and `$regexMatch`.
 *
 * @example
 * ```ts
 * const spec: RegexSpec = { input: f.name, regex: /^a/, options: "i" };
 * ```
 */
export interface RegexSpec {
  /** The string to search. */
  input: Arg<Nullable<string>>;
  /** The pattern: an expression or a `RegExp`. */
  regex: Arg<string> | RegExp;
  /** The regex flags, e.g. `"i"`. */
  options?: string;
}

/**
 * Serializes a regex spec; `options` is left out when not given.
 *
 * @param spec - The regex spec.
 * @returns The MongoDB value of the spec.
 */
const regexSpec = (spec: RegexSpec): Record<string, unknown> => ({
  input: ExprNodes.serialize(spec.input),
  regex: ExprNodes.serialize(spec.regex),
  ...(spec.options === undefined ? {} : { options: spec.options }),
});

/**
 * Builds a `(string, start, length)` substring operator.
 *
 * @param op - The MongoDB operator name, with the `$`.
 * @returns The typed operator; `null` input gives `""`.
 */
const substring =
  (op: string) =>
  (str: Arg<Nullable<string>>, start: Arg<number>, length: Arg<number>): Expr<string> =>
    F.node(op, [ExprNodes.serialize(str), ExprNodes.serialize(start), ExprNodes.serialize(length)]);

/**
 * Builds an `$indexOf*` operator.
 *
 * @param op - The MongoDB operator name, with the `$`.
 * @returns The typed operator; the index is `-1` when the substring is absent, `null` for a `null` string.
 */
const indexOf =
  (op: string) =>
  <A extends Arg<Nullable<string>>>(
    str: A,
    substr: Arg<string>,
    start?: Arg<number>,
    end?: Arg<number>,
  ): Expr<PropagateNull<number, A>> =>
    F.node(op, [str, substr, start, end].filter((a) => a !== undefined).map(ExprNodes.serialize));

/**
 * Builds a `$trim` / `$ltrim` / `$rtrim` operator.
 *
 * @param op - The MongoDB operator name, with the `$`.
 * @returns The typed operator taking `{ input, chars? }`; `null` when an argument can be `null`.
 */
const trimming =
  (op: string) =>
  <I extends Arg<Nullable<string>>, C extends Arg<Nullable<string>> = never>(spec: {
    input: I;
    chars?: C;
  }): Expr<PropagateNull<string, I | C>> =>
    F.node(op, ExprNodes.spec(spec));

/**
 * Builds a `$replaceOne` / `$replaceAll` operator.
 *
 * @param op - The MongoDB operator name, with the `$`.
 * @returns The typed operator taking `{ input, find, replacement }`; `null` when an argument can be `null`.
 */
const replacing =
  (op: string) =>
  <I extends Arg<Nullable<string>>, Fi extends Arg<Nullable<string>>, R extends Arg<Nullable<string>>>(spec: {
    input: I;
    find: Fi;
    replacement: R;
  }): Expr<PropagateNull<string, I | Fi | R>> =>
    F.node(op, ExprNodes.spec(spec));

/** String operators. */
export const stringOps = {
  /**
   * Uppercase (`null` → `""`).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/toUpper/
   */
  toUpper: F.unaryTo<string, string>("$toUpper"),
  /**
   * Lowercase (`null` → `""`).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/toLower/
   */
  toLower: F.unaryTo<string, string>("$toLower"),
  /**
   * Length in code points (fails on `null`).
   *
   * @param x - The string.
   * @returns The number of code points.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/strLenCP/
   */
  strLenCP: (x: Arg<string>): Expr<number> => F.node("$strLenCP", ExprNodes.serialize(x)),
  /**
   * Length in UTF-8 bytes (fails on `null`).
   *
   * @param x - The string.
   * @returns The number of bytes.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/strLenBytes/
   */
  strLenBytes: (x: Arg<string>): Expr<number> => F.node("$strLenBytes", ExprNodes.serialize(x)),
  /**
   * Concatenation of 2+ strings.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/concat/
   */
  concat: F.variadicNull<string, string>("$concat"),
  /**
   * Splits by a delimiter.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/split/
   */
  split: F.binaryNull<string, string[]>("$split"),
  /**
   * Case-insensitive comparison: `-1`, `0`, `1`.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/strcasecmp/
   */
  strcasecmp: F.binarySame<string, -1 | 0 | 1>("$strcasecmp"),
  /**
   * Substring by code points `(string, start, length)`.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/substrCP/
   */
  substrCP: substring("$substrCP"),
  /**
   * Substring by bytes `(string, start, length)`.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/substrBytes/
   */
  substrBytes: substring("$substrBytes"),
  /**
   * Deprecated alias of `$substrBytes`.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/substr/
   */
  substr: substring("$substr"),
  /**
   * Byte index of a substring, `-1` if absent.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/indexOfBytes/
   */
  indexOfBytes: indexOf("$indexOfBytes"),
  /**
   * Code-point index of a substring, `-1` if absent.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/indexOfCP/
   */
  indexOfCP: indexOf("$indexOfCP"),
  /**
   * Trims both ends.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/trim/
   */
  trim: trimming("$trim"),
  /**
   * Trims the start.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/ltrim/
   */
  ltrim: trimming("$ltrim"),
  /**
   * Trims the end.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/rtrim/
   */
  rtrim: trimming("$rtrim"),
  /**
   * Replaces the first occurrence.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/replaceOne/
   */
  replaceOne: replacing("$replaceOne"),
  /**
   * Replaces every occurrence.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/replaceAll/
   */
  replaceAll: replacing("$replaceAll"),
  /**
   * First regex match or `null`.
   *
   * @param spec - The input, the pattern and the flags.
   * @returns The first match, or `null` when there is none.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/regexFind/
   */
  regexFind: (spec: RegexSpec): Expr<RegexMatch | null> => F.node("$regexFind", regexSpec(spec)),
  /**
   * All regex matches.
   *
   * @param spec - The input, the pattern and the flags.
   * @returns Every match, in order.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/regexFindAll/
   */
  regexFindAll: (spec: RegexSpec): Expr<RegexMatch[]> => F.node("$regexFindAll", regexSpec(spec)),
  /**
   * Does the input match.
   *
   * @param spec - The input, the pattern and the flags.
   * @returns Whether the input matches the pattern.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/regexMatch/
   */
  regexMatch: (spec: RegexSpec): Expr<boolean> => F.node("$regexMatch", regexSpec(spec)),
};
