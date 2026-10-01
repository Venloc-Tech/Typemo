/** The options Node and Bun hand to an inspect hook (the part Typemo passes on). */
type InspectOptions = object;

/** The `util.inspect` function handed to the hook as its third argument. */
export type Inspect = (value: unknown, options?: InspectOptions) => string;

/**
 * How a hydrated document and a subdocument print in `console.log` and `util.inspect`: the class name and the plain
 * data (`$toObject` without `Hidden` fields: BSON values and Maps stay what they are, and printing a document in a
 * log never prints a hidden value), without the layer's internals (`$parent`, the tracking state). Registered on the
 * layer prototypes through the well-known `nodejs.util.inspect.custom` symbol, so it runs only when something is
 * printed: creating, reading and saving a document do not touch it.
 *
 * @example
 * ```ts
 * declare const user: User;
 * console.log(user); // User { _id: ObjectId("…"), name: "Ann" }
 * ```
 */
export class DocumentInspection {
  /** The symbol `util.inspect` looks up (shared across realms, so no `node:util` import is needed). */
  static readonly CUSTOM: unique symbol = Symbol.for("nodejs.util.inspect.custom");

  /**
   * The text of one document or subdocument.
   *
   * @param self - The document or subdocument.
   * @param plain - Produces its plain data.
   * @param depth - The remaining depth the caller allows.
   * @param options - The caller's inspect options.
   * @param inspect - The caller's `util.inspect`.
   * @returns `ClassName { … }`, or `[ClassName]` past the depth.
   */
  static render(
    self: object,
    plain: () => unknown,
    depth: number,
    options: InspectOptions | undefined,
    inspect: Inspect,
  ): string {
    const name = self.constructor.name;
    if (depth < 0) return `[${name}]`;
    let data: unknown;
    try {
      data = plain();
    } catch {
      /* A printing hook must never throw (a document that was deleted or half-built still has to be logged). */
      return `${name} { <unreadable> }`;
    }
    return `${name} ${inspect(data, { ...options, depth })}`;
  }
}
