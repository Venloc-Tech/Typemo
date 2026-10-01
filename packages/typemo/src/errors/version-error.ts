import { TypemoError } from "./typemo-error.ts";

/**
 * A versioned save matched no document: someone else changed it since it was read (optimistic
 * concurrency on the `__v` version key). Thrown by `save()`.
 */
export class VersionError extends TypemoError {
  /** The model name. */
  readonly model: string;
  /** The version the document was read with. */
  readonly version: number;
  /** The paths the failed save modified. */
  readonly modifiedPaths: readonly string[];

  /**
   * @param model - The model name.
   * @param version - The version the document was read with.
   * @param modifiedPaths - The paths the failed save modified.
   */
  constructor(model: string, version: number, modifiedPaths: readonly string[]) {
    super(
      `${model}: no document at version ${version} (it was changed or deleted since it was read); modified: ${modifiedPaths.join(", ")}`,
    );
    this.model = model;
    this.version = version;
    this.modifiedPaths = Object.freeze([...modifiedPaths]);
  }

  static {
    Object.defineProperty(VersionError.prototype, "name", {
      value: "VersionError",
      writable: true,
      configurable: true,
    });
  }
}
