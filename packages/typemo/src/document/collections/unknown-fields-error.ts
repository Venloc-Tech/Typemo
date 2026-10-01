import { TypemoError } from "../../errors/typemo-error.ts";

/**
 * Fields of a stored (sub)document that the schema does not know (data of an older or newer schema).
 *
 * @example
 * ```ts
 * const fields: UnknownFields = { path: "address", keys: ["legacyZip"] };
 * ```
 */
export interface UnknownFields {
  /** Code path of the (sub)document (`lines.0`, `address`, `notes.home`). */
  readonly path: string;
  /** Its stored keys the schema does not declare, in stored order. */
  readonly keys: readonly string[];
}

/**
 * Formats the unknown fields for an error message.
 *
 * @param fields - The (sub)documents with unknown keys.
 * @returns A `"path" (key, key); ...` list.
 */
const describe = (fields: readonly UnknownFields[]): string =>
  fields.map((field) => `"${field.path}" (${field.keys.join(", ")})`).join("; ");

/**
 * A save would REPLACE a stored subdocument (or rewrite an array or Map holding one) that has fields the
 * schema does not know, so those fields would be lost from the database. By default this is an error —
 * Typemo never drops stored data silently. The unknown keys are remembered when the document is read (no
 * extra query). `$save({ dropUnknownFields: true })` / `bulkSave(docs, { dropUnknownFields: true })`
 * accepts the loss explicitly.
 *
 * @example
 * ```ts
 * await user.$save(); // throws UnknownFieldsError when `address` holds stored keys the schema lacks
 * await user.$save({ dropUnknownFields: true }); // accepts the loss
 * ```
 */
export class UnknownFieldsError extends TypemoError {
  /** Every stored (sub)document the write would rewrite without its unknown fields. */
  readonly fields: readonly UnknownFields[];

  /**
   * @param fields - The (sub)documents whose unknown keys the write would drop.
   */
  constructor(fields: readonly UnknownFields[]) {
    super(
      `the save would drop fields the schema does not know from stored data: ${describe(fields)}; ` +
        "migrate the data or the schema, or pass { dropUnknownFields: true } to $save()/bulkSave() to accept the loss",
    );
    this.fields = Object.freeze(fields.map((field) => Object.freeze({ path: field.path, keys: [...field.keys] })));
  }

  static {
    Object.defineProperty(UnknownFieldsError.prototype, "name", {
      value: "UnknownFieldsError",
      writable: true,
      configurable: true,
    });
  }
}

/**
 * Type guard of {@link UnknownFieldsError}.
 *
 * @param error - The value to test.
 * @returns `true` when the value is an `UnknownFieldsError`.
 */
export const isUnknownFieldsError = (error: unknown): error is UnknownFieldsError =>
  error instanceof UnknownFieldsError;
