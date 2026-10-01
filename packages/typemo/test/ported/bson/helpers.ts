/* Shared by the ported caster tests. */
import { CastError } from "../../../src/index.ts";

/**
 * Runs a cast that is expected to fail and returns its error.
 *
 * @param run - the cast to run
 * @returns the `CastError` the cast threw
 * @throws the original error when it is not a `CastError`, or an `Error` when the cast succeeded
 */
export const castFailure = (run: () => unknown): CastError => {
  try {
    run();
  } catch (error) {
    if (error instanceof CastError) return error;
    throw error;
  }
  throw new Error("expected a CastError, the cast succeeded");
};
