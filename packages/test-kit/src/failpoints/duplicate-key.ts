import type { Collection, Document, MongoServerError } from "mongodb";

/** Server error code of a duplicate-key violation. */
const DUPLICATE_KEY_CODE = 11000;

/**
 * Deterministic duplicate-key scenario: insert `doc` twice into
 * `collection` (which must have a unique index covering it — `_id` always
 * qualifies) and return the resulting `MongoServerError`, so tests can
 * assert on `error.code`, `error.keyPattern`, `error.keyValue`, etc.
 */
export class DuplicateKeyScenario {
  /**
   * Inserts `doc` twice and captures the duplicate-key error of the second insert.
   *
   * @param collection - Collection with a unique index that covers `doc`.
   * @param doc - The document to insert twice.
   * @returns The server error of the second insert.
   * @throws Error - When the second insert succeeds, or fails with an error that is not a duplicate-key error.
   */
  static async trigger(collection: Collection, doc: Document): Promise<MongoServerError> {
    /* Insert two independent copies: the driver mutates a bare object to add
       a generated `_id` when it inserts it, and reusing the very same object
       for both calls would make the two inserts collide on `_id` even when
       the scenario is meant to exercise a different unique index. */
    await collection.insertOne({ ...doc });
    try {
      await collection.insertOne({ ...doc });
    } catch (error) {
      if (DuplicateKeyScenario.#isDuplicateKeyError(error)) {
        return error;
      }
      throw error;
    }
    throw new Error("Expected a duplicate key error on the second insertOne(), but it succeeded");
  }

  /**
   * Narrows an unknown error to a duplicate-key server error.
   *
   * @param error - The caught value.
   * @returns `true` when it carries the duplicate-key code.
   */
  static #isDuplicateKeyError(error: unknown): error is MongoServerError {
    return error instanceof Error && "code" in error && (error as { code?: unknown }).code === DUPLICATE_KEY_CODE;
  }
}
