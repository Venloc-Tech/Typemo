/**
 * The contract of every caster. A scalar caster is a static class that satisfies this
 * interface with its statics (`ArrayCaster.of(StringCaster)` passes the class itself); a
 * parametrized caster (`ArrayCaster.of`, `VectorCaster.of`, …) returns an object of this shape.
 *
 * - `cast` turns user input into the hydrated value (see `BsonScalarForms`): the native type passes,
 *   the conversions of the safe list are applied, everything else throws `CastError`.
 *   It never mutates its input and never returns a mutable object shared with it.
 * - `encode` turns a hydrated value into the value handed to the driver. It exists because the
 *   hydrated form does not always fix the BSON type on the wire: a `number` is serialized as int32
 *   or double depending on its value, so `Int32Caster`/`DoubleCaster` wrap it.
 *
 * Methods (not arrow properties) on purpose: parameter bivariance lets a `ValueCaster<string>` sit in
 * a list of `ValueCaster<unknown>` members (unions, subdocument fields).
 *
 * @typeParam T - The hydrated type the caster produces.
 * @example
 * ```ts
 * const caster: ValueCaster<string> = StringCaster;
 * caster.cast("a"); // "a"
 * caster.cast(1); // throws CastError
 * ```
 */
export interface ValueCaster<T> {
  /** The expected type in the vocabulary of error messages: `Int32`, `ObjectId`, `Array<string>`. */
  readonly expected: string;
  /**
   * Turns user input into the hydrated value.
   *
   * @param value - The user input.
   * @param path - Dotted path of the value, used in error messages.
   * @returns The hydrated value.
   * @throws {CastError} When the input cannot be cast.
   */
  cast(value: unknown, path?: string): T;
  /**
   * Turns a hydrated value into the value handed to the driver.
   *
   * @param value - The hydrated value.
   * @returns The value to serialize.
   */
  encode(value: T): unknown;
}

/**
 * The hydrated type a caster produces.
 *
 * @typeParam C - The caster type to read the output of.
 * @example
 * ```ts
 * type Out = CastOutput<ValueCaster<string>>; // string
 * type Bad = CastOutput<number>; // never
 * ```
 */
export type CastOutput<C> = C extends ValueCaster<infer T> ? T : never;
