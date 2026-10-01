import { TypemoError } from "../../errors/typemo-error.ts";

/**
 * The array was loaded only in part (`$slice`, positional `arr.$`, `$elemMatch` projection) and the
 * change would overwrite the elements that were not loaded: a `$set` of the whole array, a positional
 * `$set` (positions differ from the stored ones) or `$pop`. Mongoose could silently overwrite them. Atomics that do not depend on positions (`push`,
 * `addToSet`, `pull`) stay allowed.
 *
 * @example
 * ```ts
 * declare const id: ObjectId;
 * const user = await Users.findById(id).select({ tags: { $slice: 2 } }).orFail();
 * user.tags.splice(0, 1);
 * await user.$save(); // throws PartialArrayError
 * ```
 */
export class PartialArrayError extends TypemoError {
  /** Code path of the array. */
  readonly path: string;

  /**
   * @param path - Code path of the array.
   * @param operation - The refused change, described for the message.
   */
  constructor(path: string, operation: string) {
    super(
      `"${path}" was loaded partially (projection); ${operation} would overwrite the elements that were not loaded`,
    );
    this.path = path;
  }

  static {
    Object.defineProperty(PartialArrayError.prototype, "name", {
      value: "PartialArrayError",
      writable: true,
      configurable: true,
    });
  }
}
