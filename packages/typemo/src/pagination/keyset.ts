import { createHmac, timingSafeEqual } from "node:crypto";
import { EJSON } from "bson";
import type { SortDirectionInput } from "../aggregate/expressions/sort-spec.ts";
import { BsonGuards } from "../bson/bson-guards.ts";
import { CastError } from "../errors/cast-error.ts";
import { ConfigurationError } from "../errors/configuration-error.ts";
import { QueryError } from "../errors/query-error.ts";
import type { TypemoErrorOptions } from "../errors/typemo-error.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import type { LeanOf } from "../types/document-forms.ts";
import type { Orderable } from "../types/filter.ts";
import type { DataKeys } from "../types/schema-paths.ts";

/*
 * Keyset pagination: a page is "the rows after the last one seen" in a TOTAL order — the sort keys plus `_id`
 * as the last tiebreak — so a page costs the same at any depth and nothing repeats or is skipped when rows
 * are added or removed meanwhile (unlike `skip`).
 * - The sort keys are REQUIRED, non-nullable, orderable top-level fields — in the type (`KeysetKey<T>`)
 *   and at run time (the schema's `required`, not `nullable`): a missing value cannot be a position. The
 *   timestamps of `Timestamped` count as required: the core fills them on every insert.
 * - The sort is a list of pairs (explicit order; an object's key order is not the written order for
 *   numeric-like keys).
 * - The token is EJSON (every BSON type round-trips: `bigint`, `Decimal128`, `UUID`, … — not only Date and
 *   ObjectId), base64url. It comes back from a client, so it is UNTRUSTED input: length and alphabet are
 *   checked before parsing, the structure exactly, the keys must be this sort's, every value must be a
 *   scalar that the field's own caster accepts (no objects, no operators). Any failure is a
 *   `KeysetTokenError`. By default the token is not signed: it is a position, not a permission (the filter
 *   of the query still applies to every page). With the client option `keysetSecret` it is
 *   `<payload>.<HMAC-SHA256 of the payload>` (base64url both); the signature is checked (constant time)
 *   BEFORE the payload is parsed, and an unsigned or wrongly signed token is refused.
 */

/**
 * A top-level field usable as a keyset sort key: required (not optional), not nullable, orderable.
 *
 * @example
 * ```ts
 * class Post { title!: string; score?: number; deletedAt!: Date | null }
 * type Keys = KeysetKey<Post>; // "title"  (`score` is optional, `deletedAt` is nullable)
 * ```
 */
export type KeysetKey<T> = {
  [K in DataKeys<T>]-?: undefined extends T[K & keyof T]
    ? never
    : null extends T[K & keyof T]
      ? never
      : [LeanOf<NonNullable<T[K & keyof T]>>] extends [Orderable]
        ? K
        : never;
}[DataKeys<T>];

/**
 * The order of a keyset page: pairs `[field, direction]`, in order; `_id` is appended as the tiebreak.
 *
 * @example
 * ```ts
 * const sort: KeysetSort<Post> = [["title", "asc"], ["_id", -1]];
 * ```
 */
export type KeysetSort<T> = readonly [
  readonly [KeysetKey<T> | "_id", SortDirectionInput],
  ...(readonly [KeysetKey<T> | "_id", SortDirectionInput])[],
];

/**
 * One page of a keyset pagination.
 *
 * @example
 * ```ts
 * const page: KeysetPage<Post> = await Posts.keysetPage({ sort: [["title", "asc"]], limit: 20 });
 * const next = await Posts.keysetPage({ sort: [["title", "asc"]], limit: 20, after: page.nextCursor });
 * ```
 */
export interface KeysetPage<Row> {
  /** The rows of this page, in the requested order. */
  readonly items: Row[];
  /** Pass it as `after` for the next page; `null` on the last page. */
  readonly nextCursor: string | null;
  /** `true` when there is a next page. */
  readonly hasMore: boolean;
}

/**
 * A keyset token that is not one this sort made (tampered, truncated, of another sort, of wrong types).
 *
 * @example
 * ```ts
 * const page = async (after: string): Promise<number> => {
 *   try {
 *     return (await Posts.keysetPage({ sort: [["title", "asc"]], limit: 20, after })).items.length;
 *   } catch (error) {
 *     if (error instanceof KeysetTokenError) return 400; // a bad request, not a server error
 *     throw error;
 *   }
 * };
 * ```
 */
export class KeysetTokenError extends QueryError {
  /**
   * @param reason - Why the token was refused.
   * @param options - Optional `cause`.
   */
  constructor(reason: string, options: TypemoErrorOptions = {}) {
    super(`keysetPage: invalid cursor — ${reason}`, { ...options, path: "after" });
  }

  static {
    Object.defineProperty(KeysetTokenError.prototype, "name", {
      value: "KeysetTokenError",
      writable: true,
      configurable: true,
    });
  }
}

/**
 * The runtime plan of one page.
 *
 * @example
 * ```ts
 * declare const plan: KeysetPlan; // of `keysetPage({ sort: [["title", "asc"]], limit: 20 })`
 * plan.keys; // [["title", 1], ["_id", 1]]
 * ```
 */
export interface KeysetPlan {
  /** The resolved sort, `_id` last. */
  readonly keys: readonly (readonly [string, 1 | -1])[];
  /** The condition "after the token" (`undefined` for the first page). */
  readonly after: Readonly<Record<string, unknown>> | undefined;
  /** The page size. */
  readonly limit: number;
}

/** Longest token accepted (a few keys of ids and dates are far below). */
const MAX_TOKEN = 4096;
/** The alphabet of an unsigned token. */
const BASE64URL = /^[A-Za-z0-9_-]+$/;
/** A signed token: payload and signature (a SHA-256 HMAC is 43 base64url characters). */
const SIGNED = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/;

/**
 * @param secret - The HMAC key.
 * @param payload - The token payload.
 * @returns The base64url HMAC-SHA256 of the payload.
 */
const sign = (secret: Uint8Array, payload: string): string =>
  createHmac("sha256", secret).update(payload, "utf8").digest("base64url");

/**
 * Extracts the payload of a token; when signing is on, verifies the signature against every key first.
 *
 * @param token - The token from the client.
 * @param secrets - The signing keys, empty when tokens are not signed.
 * @returns The base64url payload.
 * @throws {KeysetTokenError} When the token is signed but signing is off, unsigned but signing is on, not
 *   base64url, or its signature is wrong.
 */
const payloadOf = (token: string, secrets: readonly Uint8Array[]): string => {
  const signed = SIGNED.exec(token);
  if (secrets.length === 0) {
    if (signed !== null) throw new KeysetTokenError("it is signed, but this client has no keysetSecret");
    if (!BASE64URL.test(token)) throw new KeysetTokenError("not base64url");
    return token;
  }
  if (signed === null) throw new KeysetTokenError("it is not signed (the client signs its tokens: keysetSecret)");
  const [, payload, signature] = signed as unknown as [string, string, string];
  const given = Buffer.from(signature, "base64url");
  const valid = secrets.some((secret) => {
    const expected = Buffer.from(sign(secret, payload), "base64url");
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
  if (!valid) throw new KeysetTokenError("the signature is not valid");
  return payload;
};

/** The token format version, checked on decode. */
const TOKEN_VERSION = 1;

/**
 * Normalizes a sort direction.
 *
 * @param value - `1`, `-1`, `"asc"`, `"ascending"`, `"desc"` or `"descending"`.
 * @param path - The sort field, used in the error.
 * @returns `1` or `-1`.
 * @throws {QueryError} When the value is not a direction.
 */
const direction = (value: unknown, path: string): 1 | -1 => {
  switch (value) {
    case 1:
    case "asc":
    case "ascending":
      return 1;
    case -1:
    case "desc":
    case "descending":
      return -1;
    default:
      throw new QueryError(`keysetPage: sort "${path}" must be 1, -1, "asc" or "desc"`, { path });
  }
};

/** Keyset pagination helpers. */
export class Keyset {
  /**
   * Resolves the sort: `_id` is appended (same direction as the last key) and every key is checked against
   * the schema.
   *
   * @param schema - The model's compiled schema.
   * @param sort - The user's sort, a list of `[field, direction]` pairs.
   * @returns The frozen resolved keys.
   * @throws {QueryError} When the sort is malformed, names a field twice or an unknown field.
   * @throws {ConfigurationError} When a key is not a required, non-nullable, orderable scalar.
   */
  static keys(schema: CompiledSchema, sort: unknown): readonly (readonly [string, 1 | -1])[] {
    if (!Array.isArray(sort) || sort.length === 0)
      throw new QueryError("keysetPage: sort is a non-empty list of [field, direction] pairs", { path: "sort" });
    const keys: (readonly [string, 1 | -1])[] = [];
    for (const pair of sort as unknown[]) {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string")
        throw new QueryError("keysetPage: a sort entry is a [field, direction] pair", { path: "sort" });
      const [path, dir] = pair as [string, unknown];
      if (keys.some(([key]) => key === path)) throw new QueryError(`keysetPage: sort names "${path}" twice`, { path });
      Keyset.checkKey(schema, path);
      keys.push(Object.freeze([path, direction(dir, path)] as const));
    }
    const last = keys.at(-1);
    if (last !== undefined && !keys.some(([path]) => path === "_id"))
      keys.push(Object.freeze(["_id", last[1]] as const));
    return Object.freeze(keys);
  }

  /**
   * Checks that a sort key is a required (or always filled: `createdAt`/`updatedAt` of `Timestamped`),
   * non-nullable, orderable top-level field (or `_id`).
   *
   * @param schema - The model's compiled schema.
   * @param path - The sort key.
   * @throws {QueryError} When the field does not exist.
   * @throws {ConfigurationError} When the field cannot be a position.
   */
  private static checkKey(schema: CompiledSchema, path: string): void {
    const node = schema.field(path);
    if (node === undefined)
      throw new QueryError(`keysetPage: sort "${path}" is not a top-level field of ${schema.name}`, { path });
    if (path === "_id") return;
    /* `createdAt`/`updatedAt` of `Timestamped` are not `required` in the schema, but the core fills them on
     * every insert and they are not nullable: every stored row has a position. */
    const alwaysFilled = node.service === "createdAt" || node.service === "updatedAt";
    /* Presence first, for every scalar: an optional field gets one message whatever its type. */
    if (node.kind === "scalar" && ((!node.required && !alwaysFilled) || node.nullable))
      throw new ConfigurationError(
        `keysetPage: sort "${path}" of ${schema.name} must be required and not nullable (a missing value cannot be a position)`,
      );
    if (node.kind !== "scalar" || node.type === "boolean" || node.type === "regex" || node.type === "vector")
      throw new ConfigurationError(`keysetPage: sort "${path}" of ${schema.name} is not an orderable scalar field`);
  }

  /**
   * Builds the condition of the rows after `values` in the order `keys` (a lexicographic `$or`).
   *
   * @param keys - The resolved sort keys.
   * @param values - The position: one value per key.
   * @returns The filter fragment.
   */
  static afterFilter(
    keys: readonly (readonly [string, 1 | -1])[],
    values: readonly unknown[],
  ): Readonly<Record<string, unknown>> {
    return {
      $or: keys.map(([path, dir], index) => ({
        ...Object.fromEntries(keys.slice(0, index).map(([previous], at) => [previous, values[at]])),
        [path]: { [dir === 1 ? "$gt" : "$lt"]: values[index] },
      })),
    };
  }

  /**
   * Plans a page: keys, limit and the decoded, validated `after` condition.
   *
   * @param schema - The model's compiled schema.
   * @param options - The user's `sort`, `limit` and optional `after` token.
   * @param secrets - The signing keys, empty when tokens are not signed.
   * @returns The frozen plan.
   * @throws {QueryError} When `limit` is not a positive integer or the sort is invalid.
   * @throws {KeysetTokenError} When `after` is not a valid token.
   */
  static plan(
    schema: CompiledSchema,
    options: { readonly sort: unknown; readonly limit: unknown; readonly after?: unknown },
    secrets: readonly Uint8Array[] = [],
  ): KeysetPlan {
    const { limit } = options;
    if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1)
      throw new QueryError(`keysetPage: limit must be a positive integer, got ${CastError.describe(limit)}`, {
        path: "limit",
      });
    const keys = Keyset.keys(schema, options.sort);
    const after =
      options.after === undefined || options.after === null
        ? undefined
        : Keyset.afterFilter(keys, Keyset.decode(schema, keys, options.after, secrets));
    return Object.freeze({ keys, after, limit });
  }

  /**
   * Makes the token of the position after `row` (the last row of a page); signed with the first key when
   * signing is on.
   *
   * @param keys - The resolved sort keys.
   * @param row - The last row of the page.
   * @param secrets - The signing keys, empty when tokens are not signed.
   * @returns The token.
   * @throws {QueryError} When the row has no value for a sort key.
   */
  static encode(
    keys: readonly (readonly [string, 1 | -1])[],
    row: object,
    secrets: readonly Uint8Array[] = [],
  ): string {
    const values = keys.map(([path]) => {
      const value = (row as Record<string, unknown>)[path];
      if (value === null || value === undefined)
        throw new QueryError(`keysetPage: the row has no value for the sort key "${path}"`, { path });
      return value;
    });
    const text = EJSON.stringify(
      { v: TOKEN_VERSION, k: keys.map(([path, dir]) => [path, dir]), x: values },
      { relaxed: false },
    );
    const payload = Buffer.from(text, "utf8").toString("base64url");
    const [secret] = secrets;
    return secret === undefined ? payload : `${payload}.${sign(secret, payload)}`;
  }

  /**
   * Decodes and validates a token from a client (untrusted input).
   *
   * @param schema - The model's compiled schema; its casters convert every value.
   * @param keys - The resolved sort keys the token must match.
   * @param token - The token.
   * @param secrets - The signing keys, empty when tokens are not signed.
   * @returns The position: one cast value per key.
   * @throws {KeysetTokenError} When the token is malformed, signed wrongly, of another sort, or holds a
   *   value that is not a scalar of the field's type.
   */
  static decode(
    schema: CompiledSchema,
    keys: readonly (readonly [string, 1 | -1])[],
    token: unknown,
    secrets: readonly Uint8Array[] = [],
  ): unknown[] {
    if (typeof token !== "string" || token.length === 0) throw new KeysetTokenError("not a string");
    if (token.length > MAX_TOKEN) throw new KeysetTokenError(`longer than ${MAX_TOKEN} characters`);
    const payload = payloadOf(token, secrets);
    let parsed: unknown;
    try {
      parsed = EJSON.parse(Buffer.from(payload, "base64url").toString("utf8"), { relaxed: true, useBigInt64: true });
    } catch (error) {
      throw new KeysetTokenError("it cannot be read", { cause: error });
    }
    if (!BsonGuards.isPlainObject(parsed)) throw new KeysetTokenError("not an object");
    const fields = Object.keys(parsed).sort().join(",");
    if (fields !== "k,v,x") throw new KeysetTokenError("unexpected fields");
    if (parsed.v !== TOKEN_VERSION) throw new KeysetTokenError("unknown version");
    const k = parsed.k;
    const x = parsed.x;
    if (!Array.isArray(k) || !Array.isArray(x) || k.length !== keys.length || x.length !== keys.length)
      throw new KeysetTokenError("it was made for another sort");
    keys.forEach(([path, dir], index) => {
      const entry = k[index] as unknown;
      if (!Array.isArray(entry) || entry.length !== 2 || entry[0] !== path || entry[1] !== dir)
        throw new KeysetTokenError("it was made for another sort");
    });
    return keys.map(([path], index) => {
      const value = x[index] as unknown;
      /* A position is a scalar: an object here could only be an operator (`{ $ne: null }`) or garbage. */
      if (value === null || value === undefined || Array.isArray(value) || BsonGuards.isPlainObject(value))
        throw new KeysetTokenError(`the value of "${path}" is not a scalar`);
      const node = schema.field(path);
      if (node === undefined) throw new KeysetTokenError(`unknown field "${path}"`);
      try {
        return node.caster.cast(value, path);
      } catch (error) {
        throw new KeysetTokenError(`the value of "${path}" is not a ${node.caster.expected}`, { cause: error });
      }
    });
  }
}
