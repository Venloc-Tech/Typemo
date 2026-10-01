import type { ValueCaster } from "./value-caster.ts";

/**
 * Makes a path nullable: `null` passes as `null`, everything else goes to the inner
 * caster. Without this wrapper every caster refuses `null` (reason `null`). `undefined` is refused
 * either way (reason `undefined`), and `''` is never turned into `null` (a Mongoose legacy for
 * HTML forms).
 */
export class NullableCaster {
  /**
   * Wraps a caster so it also accepts `null`.
   *
   * @typeParam T - The hydrated type of the inner caster.
   * @param inner - The caster that handles every non-null value.
   * @returns A caster of `T | null`.
   */
  static of<T>(inner: ValueCaster<T>): ValueCaster<T | null> {
    return {
      /*
       * A getter: the lazy caster of a container node (array, Map, subdocument) can name its type only
       * after the node exists, so reading `expected` eagerly crashed `nullable: true` containers.
       */
      get expected(): string {
        return `${inner.expected} | null`;
      },
      cast: (value: unknown, path = ""): T | null => (value === null ? null : inner.cast(value, path)),
      encode: (value: T | null): unknown => (value === null ? null : inner.encode(value)),
    };
  }
}
