import { CastError, DocumentNotFoundError, DuplicateKeyError, KeysetTokenError, QueryError, StrictModeError, ValidationError } from "@venloc/typemo";
class __NotFound__ extends Error {}
class __BadRequest__ extends Error {
  constructor(message: string, readonly issues?: unknown) { super(message); }
}
class __Conflict__ extends Error {}
// ---cut---
const toHttpError = (error: unknown): unknown => {
  if (error instanceof DocumentNotFoundError) return new __NotFound__(`${error.model} not found`);
  if (error instanceof ValidationError) return new __BadRequest__("validation failed", error.toJSON().issues);
  if (error instanceof DuplicateKeyError) return new __Conflict__("title is taken");
  if (
    error instanceof CastError ||
    error instanceof StrictModeError ||
    error instanceof KeysetTokenError ||
    error instanceof QueryError
  ) {
    return new __BadRequest__(error.message);
  }
  return error;
};

const guard = async <R>(work: () => Promise<R>): Promise<R> => {
  try {
    return await work();
  } catch (error) {
    throw toHttpError(error);
  }
};
