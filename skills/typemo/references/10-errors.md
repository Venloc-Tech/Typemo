# Errors: hierarchy, classification, HTTP mapping

Read this before writing a `catch`, an error middleware, a retry, or a log of Typemo failures. Every error Typemo throws is a `TypemoError` (so one `instanceof` separates library/database failures from your own bugs). Strictness means errors instead of silent behaviour: a failed cast, a bad filter or an empty filter in a write is an exception, never a quiet change. The service layer should catch nothing and let library errors rise; convert them to answers in **one** place at the application boundary.

## Minimal working example

```ts
import { DocumentNotFoundError, DuplicateKeyError, Entity, Prop, Schema, TypemoError, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
}

declare const client: TypemoClient;
const Accounts = client.connection.model(Account);

try {
  await Accounts.findOne({ title: "no such account" }).orFail();
} catch (error) {
  if (error instanceof DocumentNotFoundError) console.log("not found");
  else if (error instanceof DuplicateKeyError) console.log("already exists");
  else if (error instanceof TypemoError) console.log(error.message); // a library failure
  else throw error; // not ours: a bug of the caller
}
```

Check from specific to general. `DuplicateKeyError`, `ServerValidationError`, `WriteConflictError` are subclasses of `ServerError`; `KeysetTokenError` is a subclass of `QueryError`. A `catch` on the parent catches the child.

## The hierarchy

```text
TypemoError                  (message, cause; `name` is on the prototype; use instanceof, never error.name)
  ValidationError            data failed the schema: issues[], errors{} ; toJSON() is safe for a client
  CastError                  value cannot be cast: path, value, expected, reason, detail
  StrictModeError           a strictness rule: reason, path (unknown-path, empty-filter, sanitize, tenant, soft-delete, immutable, ...)
  UnknownFieldsError         a save would drop unknown fields
  DirectWriteError           the collection was changed bypassing its methods
  PartialArrayError          the array was loaded partially
  QueryError                 a query cannot be built (no `reason` field)
    KeysetTokenError         a pagination token is rejected
  DocumentNotFoundError      orFail() found nothing (also populate required: true)
  VersionError               the document changed since it was read (optimistic locking)
  EachAsyncError             callback failures in eachAsync with continueOnError
  ServerError                the database refused: code, codeName, errorLabels, serverMessage, hasErrorLabel()
    DuplicateKeyError        unique index violated: keyPattern, keyValue, index
    ServerValidationError    the collection validator refused
    WriteConflictError       two writes touched one document
  BulkWriteError             part of a batch failed: writeErrors[], result, ordered
  TimeoutError               kind: "operation" | "connection" | "transaction", timeoutMS
  ConnectionError            no connection to the server
  DriverError                the driver refused on its side
  ConfigurationError         a wrong setting (thrown at start-up / model creation / call time)
  IndexSyncError             indexes were not applied
  SyncError                  init() or syncAll() did not bring the database to the schema: operation, failures[], errors[], report
  CollectionOptionsError     collection options differ from the schema
  AuditError                 an audit write failed, the operation is rolled back
  PostHookError              a post hook threw AFTER a successful write: applied: true, operation, result, cause
  InternalError              an internal invariant broke (report it)
```

- `message` is for humans; branch on `instanceof` or structured fields (`reason`, `code`, `path`, `kind`), not on the text.
- `cause` is the original error (driver error, your hook's error). If the original held `sensitive` / `Hidden` values the `cause` is a masked copy.
- `StrictModeError.reason` is one of 13 values (see file 09); `CastError.reason` is one of 17 (`undefined`, `null`, `type`, `format`, `integer`, `range`, `finite`, `precision`, `subtype`, `dimensions`, `flags`, `key`, `unknown-key`, `union-no-match`, `union-ambiguous`, `json`, `discriminator`), visible in brackets at the end of the message: `Cast to ObjectId failed at path "author" for "zz" (string): not a 24-character hex string [format]`.
- `ValidationError.issues[]`: `{ path, reason, message, value }`; `reason` in `cast`, `required`, `unknown-key`, `enum`, `min`, `max`, `minLength`, `maxLength`, `match`, `validator`, `discriminator`, ... Message example: `Validation failed: "_id": the field is required [required]`. `create`/`$save` throw `CastError` for a bad cast; `Model.validate` and Standard Schema collect it as an issue.
- `QueryError` examples: `populate "title": "title" is neither a reference nor an embedded document`, `limit must be a positive integer, got 0 (number)`.

## HTTP mapping (one place)

```ts
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
    // toJSON() has only name, message and issues {path, reason, message}: no values, safe for the client
    return { status: 422, body: { error: "validation", details: error.toJSON().issues } };
  }
  if (error instanceof DocumentNotFoundError) return { status: 404, body: { error: "not-found" } };
  if (error instanceof DuplicateKeyError) {
    return { status: 409, body: { error: "duplicate", details: Object.keys(error.keyPattern ?? {}) } };
  }
  if (error instanceof VersionError) return { status: 409, body: { error: "changed-meanwhile" } };
  if (error instanceof CastError || error instanceof StrictModeError || error instanceof QueryError) {
    return { status: 400, body: { error: "bad-request" } }; // QueryError includes KeysetTokenError
  }
  if (error instanceof TimeoutError || error instanceof ConnectionError) {
    return { status: 503, body: { error: "unavailable" } }; // the time ran out on your side, not the user's
  }
  return { status: 500, body: { error: "internal" } };
};
```

Never put `error.message` or `serverMessage` into a response: they hold field names, values, query plans. Log the message and `cause`; send your own text or `toJSON()`.

## ErrorClassifier: logs, metrics, retries

`ErrorClassifier.classify(error)` accepts ANY thrown value, including a raw driver error from `client.unsafeDriver()`, and returns a frozen `{ kind, name, code, errorLabels, retryable, transient }`.

```ts
import { ErrorClassifier, Entity, Prop, Schema, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
}
declare const client: TypemoClient;
const Accounts = client.connection.model(Account);

export const openAccount = async (title: string): Promise<"created" | "taken" | "later"> => {
  try {
    await Accounts.create({ title });
    return "created";
  } catch (error) {
    if (ErrorClassifier.isDuplicateKey(error)) return "taken"; // narrows to DuplicateKeyError
    if (ErrorClassifier.isRetryable(error)) return "later";
    throw error;
  }
};

export const record = (error: unknown): string => {
  const { kind, code, retryable } = ErrorClassifier.classify(error);
  return `${kind} code=${code ?? "-"} retryable=${retryable}`;
};
```

- `kind` values: `validation`, `cast`, `strict`, `query`, `configuration`, `not-found`, `version`, `duplicate-key`, `server-validation`, `write-conflict`, `timeout`, `bulk-write`, `index-sync` (also `SyncError`), `post-hook`, `audit`, `each-async`, `connection`, `server`, `driver`, `other` (foreign errors and non-errors, including your hook's own error).
- Methods: `isDuplicateKey` (narrows; a `BulkWriteError` is `false`), `hasDuplicateKey` (also true for a bulk error with a duplicate), `isRetryable`, `isTransient` (label `TransientTransactionError`: the whole transaction may be re-run), `isTimeout` (narrows to `TimeoutError`).
- `retryable` is `false` for duplicate key, cast, validator refusal and `post-hook`. Check `kind === "post-hook"` before any generic retry: the write is already stored.
- Server error labels: `error.hasErrorLabel(ErrorLabels.TransientTransactionError)`.

## Special cases

```ts
import {
  BulkWriteError,
  DuplicateKeyError,
  Entity,
  PostHookError,
  Prop,
  Schema,
  SyncError,
  type TypemoClient,
} from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
}
declare const client: TypemoClient;
const Accounts = client.connection.model(Account);

// batch: partial success, indexes of the failures, counters of the rest
try {
  await Accounts.insertMany([{ title: "N1", owner: "a" }, { title: "Main", owner: "b" }], { ordered: false });
} catch (error) {
  if (error instanceof BulkWriteError) {
    const duplicates = error.writeErrors.filter((failure) => failure.error instanceof DuplicateKeyError);
    console.log(duplicates.map((failure) => failure.index), error.result.insertedCount);
  }
}

// the write happened, a post hook failed: NEVER retry
try {
  await Accounts.create({ title: "N2", owner: "ann" });
} catch (error) {
  if (error instanceof PostHookError) console.log(error.applied, error.operation, (error.cause as Error).message);
}

// start-up: init() reports every failed collection / index / view at once
try {
  await client.connection.init();
} catch (error) {
  if (error instanceof SyncError) {
    for (const failure of error.failures) console.error(failure.kind, failure.name, failure.errors.map((e) => e.message));
  }
  throw error;
}
```

- `DuplicateKeyError`: `keyPattern` (`{ title: 1 }`), `keyValue` (masked when the field is `sensitive`), `index`; in batches `keyValue` is `undefined`. `TimeoutError`: `kind` and `timeoutMS` (`transaction timed out after 200 ms (timeoutMS)`).
- Uniqueness is guaranteed only by the index (after `connection.init()`): write directly and catch `DuplicateKeyError`; "check with findOne, then create" races.
- `ServerError`: `code`, `codeName`, `errorLabels`, `serverMessage` (full server text: do not send to clients). `ServerErrorCodes` names known codes.
- `AuditError` (audit write failed): the operation was rolled back, `applied: false`. `IndexSyncError`: model-level `syncIndexes` / `createIndexes` failures (not wrapped).
- Errors inside `@PostError` replace the original; the original is in `cause`.

## Common mistakes

Bad (parent first: duplicates fall into the generic branch):

```ts
import { DuplicateKeyError, ServerError } from "@venloc/typemo";

declare const error: unknown;
// wrong: ServerError also catches DuplicateKeyError, the second branch never runs
if (error instanceof ServerError) console.log("server");
else if (error instanceof DuplicateKeyError) console.log("duplicate");
// right: specific class first
if (error instanceof DuplicateKeyError) console.log("duplicate");
else if (error instanceof ServerError) console.log("server");
```

- Bad: `error.name === "DuplicateKeyError"` (breaks for subclasses and renames). Good: `instanceof`.
- Bad: sending `error.message` to the client (`Cast to string failed at path "owner" for 5 (number)…`). Good: your own text or `toJSON()`.
- Bad: a catch-all that retries `create` on any error: after `PostHookError` the document already exists (a duplicate appears). Good: check `PostHookError` / `kind === "post-hook"` before retrying; `applied` is always `true`.
- Bad: duplicate check before write (`findOne` then `create`). Good: write and catch `DuplicateKeyError`; an index appears only after `connection.init()`, without it a duplicate is written silently.
- Bad: `catch (e) { /* ignore */ }` around library calls: strictness errors are the point. Good: let them rise to the boundary.
- Bad: catching `StrictModeError` only for client input: `undefined` values, empty `$or`, empty updates and bad `limit` are `QueryError` without `reason`. Good: handle both classes at the boundary.

## Self-check

- Library errors are caught in one boundary function (like `toHttp`), checked from the specific class to the general one with `instanceof`.
- Validation answers use `error.toJSON().issues`; no `message`, `serverMessage` or `value` reaches a client.
- Retries use `ErrorClassifier.isRetryable` / `isTransient` and never retry after `PostHookError`.
- Start-up calls `connection.init()` and logs `SyncError.failures`; uniqueness relies on indexes and `DuplicateKeyError`.
