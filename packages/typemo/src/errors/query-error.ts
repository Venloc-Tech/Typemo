import { TypemoError, type TypemoErrorOptions } from "./typemo-error.ts";

/**
 * A query or update that cannot be built: an `undefined` value (the driver would silently write or match
 * `null`), an empty `$and`/`$or`/`$nor`, a projection that mixes inclusion and exclusion, a `limit` that
 * is not a positive integer, `merge()` of another model's query. Thrown by the query builders while the
 * plan is built, before anything reaches the server.
 */
export class QueryError extends TypemoError {
  /** Where in the input the problem is (a dotted path), when known. */
  readonly path: string | undefined;

  /**
   * @param message - What is wrong with the query.
   * @param options - Optional `cause` and the `path` of the offending input.
   */
  constructor(message: string, options: TypemoErrorOptions & { readonly path?: string } = {}) {
    super(message, options);
    this.path = options.path;
  }

  static {
    Object.defineProperty(QueryError.prototype, "name", { value: "QueryError", writable: true, configurable: true });
  }
}
