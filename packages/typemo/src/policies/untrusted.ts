import { QueryError } from "../errors/query-error.ts";
import { StrictModeError } from "../errors/strict-mode-error.ts";

/*
 * `untrusted(value)` marks request data put into a filter, an update or a projection. Inside
 * it a `$`-prefixed key at ANY depth is refused: `find({ name: untrusted(req.body.name) })` with
 * `{ "$gt": "" }` in the body throws instead of matching every document (Mongoose H420, query selector
 * injection). A `+`-prefixed key is refused as well — in a projection it adds a
 * `Hidden` field, so `select(untrusted(req.query.fields))` with `{ "+passwordHash": true }` would open a
 * hidden field (Mongoose H187, `sanitizeProjection`). It is an EXTRA line of defence only: the typed filter
 * grammar makes `{ $gt: "" }` a valid condition of a string field, so request data must be validated
 * (a schema, Standard Schema) and filters built by the application — `untrusted` does not replace that.
 * The optional place only chooses the words of the error: the check is the same everywhere.
 */

/**
 * Where untrusted data goes: it only chooses the words of the error, the check is the same.
 *
 * @example
 * ```ts
 * const place: UntrustedPlace = "update";
 * ```
 */
export type UntrustedPlace = "filter" | "update" | "projection";

/** The places `untrusted` accepts (checked at run time for callers without types). */
const PLACES: ReadonlySet<string> = new Set<UntrustedPlace>(["filter", "update", "projection"]);

/** What a `$`-key would do in each place, for the error. */
const OPERATOR_RISK: Readonly<Record<UntrustedPlace, string>> = {
  filter: "an operator inside data from outside (query selector injection)",
  update: "an operator inside data from outside would change what the update does (update operator injection)",
  projection: "an operator inside data from outside would turn the projection into a computed expression",
};

/** What a `+`-key would do in each place, for the error. */
const PLUS_RISK: Readonly<Record<UntrustedPlace, string>> = {
  filter: 'a "+path" key inside data from outside is not a field name (in a projection it selects a Hidden field)',
  update: 'a "+path" key inside data from outside is not a field name (in a projection it selects a Hidden field)',
  projection: 'a "+path" key inside data from outside would select a Hidden field',
};

/**
 * Appends `key` to a dotted path.
 *
 * @param base - The path so far; empty for the root.
 * @param key - The key to append.
 * @returns The extended path.
 */
const join = (base: string, key: string): string => (base === "" ? key : `${base}.${key}`);

/**
 * Values that are data by construction (never walked): BSON values, dates, patterns, binary views.
 *
 * @param value - The object to test.
 * @returns Whether `value` is opaque.
 */
const isOpaque = (value: object): boolean =>
  value instanceof Date ||
  value instanceof RegExp ||
  ArrayBuffer.isView(value) ||
  value instanceof ArrayBuffer ||
  typeof (value as { readonly _bsontype?: unknown })._bsontype === "string";

/**
 * The deep check behind {@link untrusted}.
 *
 * @example
 * ```ts
 * Untrusted.check({ name: { $gt: "" } }); // throws StrictModeError (sanitize)
 * Untrusted.check({ $set: { role: "admin" } }, "update"); // the error speaks about the update
 * ```
 */
export class Untrusted {
  /**
   * Throws `StrictModeError("sanitize")` at the first `$`-key or `+`-key found in `value` (any depth).
   *
   * @param value - The value to walk.
   * @param place - Where the value goes; it only chooses the words of the error. Default `"filter"`.
   * @throws {StrictModeError} With rule `sanitize` at the first `$`-key or `+`-key.
   * @throws {QueryError} When `place` is not `"filter"`, `"update"` or `"projection"`.
   */
  static check(value: unknown, place: UntrustedPlace = "filter"): void {
    if (!PLACES.has(place)) {
      throw new QueryError(
        `untrusted(value, place): place must be "filter", "update" or "projection", got ${typeof place} ${JSON.stringify(place)}`,
      );
    }
    Untrusted.walk(value, place, "", new WeakSet());
  }

  /**
   * The recursion behind {@link check}.
   *
   * @param value - The value to walk.
   * @param place - Where the value goes, for the words of the error.
   * @param path - The path of `value`, for the error.
   * @param seen - The objects already visited (breaks cycles).
   * @throws {StrictModeError} With rule `sanitize` at the first `$`-key or `+`-key.
   */
  private static walk(value: unknown, place: UntrustedPlace, path: string, seen: WeakSet<object>): void {
    if (typeof value !== "object" || value === null || isOpaque(value) || seen.has(value)) return;
    seen.add(value);
    if (value instanceof Map) {
      for (const [key, item] of value) {
        const at = join(path, String(key));
        if (typeof key === "string") Untrusted.key(key, at, place);
        Untrusted.walk(item, place, at, seen);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item: unknown, index) => {
        Untrusted.walk(item, place, join(path, String(index)), seen);
      });
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      const at = join(path, key);
      Untrusted.key(key, at, place);
      Untrusted.walk(item, place, at, seen);
    }
  }

  /**
   * Refuses a key that starts with `$` or `+`.
   *
   * @param key - The key.
   * @param at - The path of the key, for the error.
   * @param place - Where the value goes, for the words of the error.
   * @throws {StrictModeError} With rule `sanitize`.
   */
  private static key(key: string, at: string, place: UntrustedPlace): void {
    const risk = key.startsWith("$") ? OPERATOR_RISK[place] : key.startsWith("+") ? PLUS_RISK[place] : undefined;
    if (risk === undefined) return;
    throw new StrictModeError(
      "sanitize",
      `untrusted value: "${key}" at "${at}" — ${risk}; validate the input and build the ${place} yourself`,
      { path: at },
    );
  }
}

/**
 * Marks `value` as data from outside (a request body, a query string) before it goes into a filter, an
 * update or a projection: a `$`-prefixed key at any depth inside it is refused with
 * `StrictModeError("sanitize")`, so `{ "$gt": "" }` cannot turn an equality into an operator; a `+`-prefixed
 * key is refused too, so `{ "+passwordHash": true }` cannot open a `Hidden` field through
 * `select()`. Returns the same value, unchanged.
 *
 * The second argument tells where the value goes, so the error speaks about that place ("build the update
 * yourself"); the check itself is the same for every place. Without it the error speaks about the filter.
 *
 * **Warning: this is only an extra line of defence, not validation.** Always validate untrusted input
 * (its type, shape and range — e.g. with a schema) and build filters yourself from the validated values;
 * `untrusted` does not check types, ranges or which fields are queried.
 *
 * @param value - The data from outside.
 * @param place - Where the value goes: `"filter"` (default), `"update"` or `"projection"`.
 * @returns `value` itself, unchanged.
 * @throws {StrictModeError} With rule `sanitize` at the first `$`-key or `+`-key.
 * @throws {QueryError} When `place` is not one of the three places (a caller without types).
 *
 * @example
 * ```ts
 * declare const req: { body: { email: string; name: string }; query: { fields: { name: 1 } } };
 * declare const _id: ObjectId;
 * await Users.findOne({ email: untrusted(req.body.email) }); // { "$ne": null } in the body → error
 * await Users.updateOne({ _id }, { $set: { name: untrusted(req.body.name, "update") } });
 * Users.find().select(untrusted(req.query.fields, "projection")); // { "+passwordHash": true } → error
 * ```
 */
export const untrusted = <const V>(value: V, place: UntrustedPlace = "filter"): V => {
  Untrusted.check(value, place);
  return value;
};
