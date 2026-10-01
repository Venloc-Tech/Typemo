import { BsonGuards } from "../bson-guards.ts";
import { CastSupport } from "./cast-support.ts";
import type { CastOutput, ValueCaster } from "./value-caster.ts";

/**
 * Field casters of a subdocument, by field name.
 *
 * @example
 * ```ts
 * const fields: SubdocumentFields = { name: StringCaster, age: Int32Caster };
 * ```
 */
export type SubdocumentFields = Readonly<Record<string, ValueCaster<unknown>>>;

/**
 * The hydrated shape a subdocument caster produces. Every field is optional: casting converts the
 * fields that are present and does not decide which are required — that is validation
 * (explicit `required`).
 *
 * @typeParam F - The field casters of the subdocument.
 * @example
 * ```ts
 * type Out = SubdocumentOutput<{ name: typeof StringCaster; age: typeof Int32Caster }>;
 * // { name?: string; age?: number }
 * ```
 */
export type SubdocumentOutput<F extends SubdocumentFields> = { -readonly [K in keyof F]?: CastOutput<F[K]> };

/**
 * Embedded document. `SubdocumentCaster.of(fields)` accepts a plain object or a class instance
 * (`BsonGuards.isPlainObject`), casts every own enumerable field with its caster into a new plain
 * object and refuses (reason `unknown-key`, strict) any field it does not declare — Mongoose
 * drops unknown fields silently. A field whose value is `undefined` is an error, a
 * missing field is simply absent. Primitives, arrays, Maps and BSON values are refused.
 */
export class SubdocumentCaster {
  /**
   * Builds a caster of an embedded document.
   *
   * @typeParam F - The field casters of the subdocument.
   * @param fields - The caster of every declared field, by name.
   * @returns A caster of the subdocument shape.
   */
  static of<const F extends SubdocumentFields>(fields: F): ValueCaster<SubdocumentOutput<F>> {
    const expected = `{ ${Object.keys(fields).join(", ")} }`;
    return {
      expected,
      cast: (value: unknown, path = ""): SubdocumentOutput<F> => {
        if (!BsonGuards.isPlainObject(value)) return CastSupport.reject(path, value, expected, "an object");
        const entries: [string, unknown][] = [];
        for (const [key, item] of Object.entries(value)) {
          const fieldPath = CastSupport.join(path, key);
          const field = Object.hasOwn(fields, key) ? fields[key] : undefined;
          if (field === undefined) {
            return CastSupport.fail(fieldPath, item, expected, "unknown-key", "not a field of this subdocument");
          }
          entries.push([key, field.cast(item, fieldPath)]);
        }
        /* fromEntries defines own data properties: a `__proto__` field could never reach the prototype. */
        return Object.fromEntries(entries) as SubdocumentOutput<F>;
      },
      encode: (value: SubdocumentOutput<F>): Record<string, unknown> =>
        Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, (fields[key] as ValueCaster<unknown>).encode(item)]),
        ),
    };
  }
}
