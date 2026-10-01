import { TypemoError } from "../../errors/typemo-error.ts";

/**
 * A tracked collection was changed around its methods — an index or `length` write, `Map.prototype.set`
 * called directly, a container field replaced by a plain value — through a cast, `any` or plain JS.
 * The type forbids all of these; the shadow copy of every collection (always on) finds them at save.
 * Typemo never guesses what such a write meant: the save is refused.
 *
 * @example
 * ```ts
 * (user.tags as unknown as string[])[0] = "x";
 * await user.$save(); // throws DirectWriteError: "tags" was changed around its methods
 * ```
 */
export class DirectWriteError extends TypemoError {
  /** Code path of the collection (`tags`, `revisions.1.lines`). */
  readonly path: string;

  /**
   * @param path - Code path of the collection.
   * @param detail - What was done around the methods.
   */
  constructor(path: string, detail: string) {
    super(`"${path}" was changed around its methods: ${detail}`);
    this.path = path;
  }

  static {
    Object.defineProperty(DirectWriteError.prototype, "name", {
      value: "DirectWriteError",
      writable: true,
      configurable: true,
    });
  }
}
