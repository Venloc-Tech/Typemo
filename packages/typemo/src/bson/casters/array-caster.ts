import { CastSupport } from "./cast-support.ts";
import type { ValueCaster } from "./value-caster.ts";

/**
 * BSON array. `ArrayCaster.of(element)` casts every element with the element caster into a new
 * array (the input is never mutated). Only a real array passes: a scalar is not wrapped into
 * `[scalar]` (Mongoose `castNonArrays`), a hole or an `undefined` element is an
 * error with the element's path (`tags.2`), not a `null`.
 */
export class ArrayCaster {
  /**
   * Builds a caster of arrays of `T`.
   *
   * @typeParam T - The hydrated element type.
   * @param element - The caster applied to every element.
   * @returns A caster of `T[]`.
   */
  static of<T>(element: ValueCaster<T>): ValueCaster<T[]> {
    const expected = `Array<${element.expected}>`;
    return {
      expected,
      cast: (value: unknown, path = ""): T[] => {
        if (!Array.isArray(value)) return CastSupport.reject(path, value, expected, "an array");
        const result: T[] = [];
        for (let index = 0; index < value.length; index++) {
          const itemPath = CastSupport.join(path, index);
          if (!(index in value)) {
            return CastSupport.fail(itemPath, undefined, element.expected, "undefined", "arrays cannot have holes");
          }
          result.push(element.cast(value[index], itemPath));
        }
        return result;
      },
      encode: (value: T[]): unknown[] => value.map((item) => element.encode(item)),
    };
  }
}
