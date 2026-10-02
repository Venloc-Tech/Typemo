import {
  CastError,
  ConnectionError,
  DocumentNotFoundError,
  DuplicateKeyError,
  QueryError,
  StrictModeError,
  TimeoutError,
  ValidationError,
  VersionError,
} from "@venloc/typemo";

export interface HttpAnswer {
  readonly status: number;
  readonly body: { readonly error: string; readonly details?: unknown };
}

export const toHttp = (error: unknown): HttpAnswer => {
  if (error instanceof ValidationError) {
    return { status: 422, body: { error: "validation", details: error.toJSON().issues } };
  }
  if (error instanceof DocumentNotFoundError) return { status: 404, body: { error: "not-found" } };
  if (error instanceof DuplicateKeyError) {
    return { status: 409, body: { error: "duplicate", details: Object.keys(error.keyPattern ?? {}) } };
  }
  if (error instanceof VersionError) return { status: 409, body: { error: "changed-meanwhile" } };
  if (error instanceof CastError || error instanceof StrictModeError || error instanceof QueryError) {
    return { status: 400, body: { error: "bad-request" } };
  }
  if (error instanceof TimeoutError || error instanceof ConnectionError) {
    return { status: 503, body: { error: "unavailable" } };
  }
  return { status: 500, body: { error: "internal" } };
};
