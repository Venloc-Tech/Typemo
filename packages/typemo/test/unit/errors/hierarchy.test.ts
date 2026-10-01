/*
 * The error hierarchy (class, name, code, path, cause) and the classification of driver errors
 * (`ErrorClassifier`). Driver errors are real `mongodb` classes, built as the driver builds them.
 */
import { describe, expect, test } from "bun:test";
import {
  MongoInvalidArgumentError,
  MongoNetworkError,
  MongoNotConnectedError,
  MongoOperationTimeoutError,
  MongoServerError,
  MongoTransactionError,
} from "mongodb";
import {
  AuditError,
  BulkWriteError,
  CastError,
  ConfigurationError,
  ConnectionError,
  DocumentNotFoundError,
  DriverError,
  DuplicateKeyError,
  EachAsyncError,
  ErrorClassifier,
  ErrorLabels,
  ErrorTranslator,
  IndexSyncError,
  InternalError,
  PostHookError,
  QueryError,
  ServerError,
  ServerErrorCodes,
  ServerValidationError,
  StrictModeError,
  TimeoutError,
  TypemoError,
  ValidationError,
  VersionError,
  WriteConflictError,
} from "../../../src/internal.ts";
import { SensitiveMaskFailure } from "../../../src/policies/sensitive-mask.ts";

const server = (fields: Record<string, unknown>, labels: readonly string[] = []) => {
  const error = new MongoServerError({ errmsg: "server says no", ...fields });
  for (const label of labels) error.addErrorLabel(label);
  return error;
};

describe("hierarchy", () => {
  const cases: [string, TypemoError, string][] = [
    ["StrictModeError", new StrictModeError("unknown-path", "nope", { path: "a.b" }), "StrictModeError"],
    ["DocumentNotFoundError", new DocumentNotFoundError("findOne", "Person"), "DocumentNotFoundError"],
    ["VersionError", new VersionError("Person", 3, ["name"]), "VersionError"],
    [
      "DuplicateKeyError",
      new DuplicateKeyError("dup", {
        code: 11000,
        codeName: "DuplicateKey",
        errorLabels: [],
        keyPattern: undefined,
        keyValue: undefined,
        index: undefined,
      }),
      "DuplicateKeyError",
    ],
    [
      "ServerValidationError",
      new ServerValidationError("bad", { code: 121, codeName: undefined, errorLabels: [], errInfo: undefined }),
      "ServerValidationError",
    ],
    [
      "WriteConflictError",
      new WriteConflictError("wc", { code: 112, codeName: undefined, errorLabels: [] }),
      "WriteConflictError",
    ],
    ["TimeoutError", new TimeoutError("operation", "late"), "TimeoutError"],
    [
      "BulkWriteError",
      new BulkWriteError(
        "insertMany",
        [],
        {
          insertedCount: 0,
          matchedCount: 0,
          modifiedCount: 0,
          deletedCount: 0,
          upsertedCount: 0,
          insertedIds: {},
          upsertedIds: {},
        },
        true,
      ),
      "BulkWriteError",
    ],
    ["IndexSyncError", new IndexSyncError("Person", []), "IndexSyncError"],
    ["ConnectionError", new ConnectionError("closed", "closed"), "ConnectionError"],
    ["DriverError", new DriverError("MongoTransactionError", "state"), "DriverError"],
    ["EachAsyncError", new EachAsyncError([new Error("a")]), "EachAsyncError"],
    ["ServerError", new ServerError("x", { code: 1, codeName: undefined, errorLabels: [] }), "ServerError"],
    /* The former TypeError of broken invariants and the audit mask failure are in the hierarchy. */
    ["InternalError", new InternalError("not a hydrated Typemo document"), "InternalError"],
    ["SensitiveMaskFailure", new SensitiveMaskFailure("pin", new Error("boom")), "SensitiveMaskFailure"],
  ];
  test.each(cases)("%s is a TypemoError with a non-enumerable name", (_, error, name) => {
    expect(error).toBeInstanceOf(TypemoError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
    expect(Object.keys(error)).not.toContain("name");
  });

  test("server-side classes share ServerError (code, codeName, labels)", () => {
    for (const error of [cases[3]?.[1], cases[4]?.[1], cases[5]?.[1]]) expect(error).toBeInstanceOf(ServerError);
  });

  test("StrictModeError carries reason and path; the reason is in the message", () => {
    const error = new StrictModeError("empty-filter", "updateMany needs a filter");
    expect(error.reason).toBe("empty-filter");
    expect(error.path).toBeUndefined();
    expect(error.message).toBe("updateMany needs a filter [empty-filter]");
  });

  test("ValidationError: issues by path", () => {
    const error = new ValidationError([
      { path: ["age"], reason: "min", message: "below 0", value: -1 },
      { path: ["pets", 0, "name"], reason: "required", message: "required", value: undefined },
      { path: ["age"], reason: "validator", message: "odd", value: -1 },
    ]);
    expect(Object.keys(error.errors)).toEqual(["age", "pets.0.name"]);
    expect(error.errors.age?.map((issue) => issue.reason)).toEqual(["min", "validator"]);
  });

  test("BulkWriteError sorts failures by input index and keeps code", () => {
    const error = new BulkWriteError(
      "insertMany",
      [
        {
          index: 4,
          code: 11000,
          message: "dup",
          error: new ServerError("dup", { code: 11000, codeName: undefined, errorLabels: [] }),
        },
        { index: 1, code: undefined, message: "invalid", error: new ValidationError([]) },
      ],
      {
        insertedCount: 2,
        matchedCount: 0,
        modifiedCount: 0,
        deletedCount: 0,
        upsertedCount: 0,
        insertedIds: {},
        upsertedIds: {},
      },
      false,
    );
    expect(error.writeErrors.map((failure) => [failure.index, failure.code])).toEqual([
      [1, undefined],
      [4, 11000],
    ]);
    expect(error.message).toContain("2 write(s) failed");
  });

  test("DocumentNotFoundError keeps no filter (personal data stays out of error logs)", () => {
    const error = new DocumentNotFoundError("updateOne", "Person");
    expect(Object.keys(error)).toEqual(["operation", "model"]);
  });
});

describe("ErrorTranslator.wrap (internal): driver errors become Typemo errors, the driver error is the cause", () => {
  test("11000 → DuplicateKeyError with keyPattern, keyValue, index", () => {
    const original = server({
      code: 11000,
      codeName: "DuplicateKey",
      errmsg: 'E11000 duplicate key error collection: db.people index: email_1 dup key: { email: "a" }',
      keyPattern: { email: 1 },
      keyValue: { email: "a" },
    });
    const error = ErrorTranslator.wrap(original) as DuplicateKeyError;
    expect(error).toBeInstanceOf(DuplicateKeyError);
    expect(error.code).toBe(11000);
    expect(error.keyPattern).toEqual({ email: 1 });
    expect(error.keyValue).toEqual({ email: "a" });
    expect(error.index).toBe("email_1");
    expect(error.cause).toBe(original);
  });

  test("121 → ServerValidationError with errInfo", () => {
    const error = ErrorTranslator.wrap(
      server({ code: 121, errInfo: { details: { rule: "x" } } }),
    ) as ServerValidationError;
    expect(error).toBeInstanceOf(ServerValidationError);
    expect(error.errInfo).toEqual({ details: { rule: "x" } });
  });

  test("112 → WriteConflictError, retryable and transient with the label", () => {
    const original = server({ code: 112, codeName: "WriteConflict" }, [ErrorLabels.TransientTransactionError]);
    const error = ErrorTranslator.wrap(original);
    expect(error).toBeInstanceOf(WriteConflictError);
    expect(ErrorClassifier.classify(original)).toMatchObject({
      kind: "write-conflict",
      code: 112,
      retryable: true,
      transient: true,
      errorLabels: ["TransientTransactionError"],
    });
    expect(ErrorTranslator.driverCause(error)).toBe(original);
  });

  test("50 MaxTimeMSExpired and MongoOperationTimeoutError → TimeoutError", () => {
    expect(ErrorTranslator.wrap(server({ code: ServerErrorCodes.MaxTimeMSExpired }))).toBeInstanceOf(TimeoutError);
    const csot = new MongoOperationTimeoutError("Timed out");
    const error = ErrorTranslator.wrap(csot) as TimeoutError;
    expect(error.kind).toBe("operation");
    expect(error.cause).toBe(csot);
  });

  test("network, closed client → ConnectionError; API misuse → DriverError", () => {
    expect((ErrorTranslator.wrap(new MongoNetworkError("reset")) as ConnectionError).failure).toBe("network");
    expect((ErrorTranslator.wrap(new MongoNotConnectedError("closed")) as ConnectionError).failure).toBe("closed");
    const misuse = ErrorTranslator.wrap(new MongoTransactionError("no transaction")) as DriverError;
    expect(misuse).toBeInstanceOf(DriverError);
    expect(misuse.driverError).toBe("MongoTransactionError");
    expect(ErrorTranslator.wrap(new MongoInvalidArgumentError("bad"))).toBeInstanceOf(DriverError);
    expect(ErrorClassifier.classify(new MongoNetworkError("reset")).retryable).toBe(true);
  });

  test("any other server code → ServerError with code/codeName/labels", () => {
    const error = ErrorTranslator.wrap(server({ code: 2, codeName: "BadValue" })) as ServerError;
    expect(error.constructor).toBe(ServerError);
    expect([error.code, error.codeName]).toEqual([2, "BadValue"]);
  });

  test("Typemo errors and user errors pass through unchanged", () => {
    const own = new QueryError("x");
    const user = new TypeError("user bug");
    expect(ErrorTranslator.wrap(own)).toBe(own);
    expect(ErrorTranslator.wrap(user)).toBe(user);
    expect(ErrorClassifier.classify(user)).toMatchObject({ kind: "other", name: "TypeError", retryable: false });
  });

  test("classification kinds of the own classes", () => {
    expect(
      ErrorClassifier.classify(new CastError({ path: "a", value: 1, expected: "String", reason: "type", detail: "x" }))
        .kind,
    ).toBe("cast");
    expect(ErrorClassifier.classify(new ValidationError([])).kind).toBe("validation");
    expect(ErrorClassifier.classify(new ConfigurationError("x")).kind).toBe("configuration");
    expect(ErrorClassifier.classify(new StrictModeError("limit", "x")).kind).toBe("strict");
    expect(ErrorClassifier.classify(new DocumentNotFoundError("find", "P")).kind).toBe("not-found");
  });

  test("PostHookError, AuditError and EachAsyncError have their own kinds, not `other`", () => {
    /* A PostHookError means the write was applied: a caller must tell it from a foreign error before it retries. */
    const post = ErrorClassifier.classify(new PostHookError("Account", "create", {}));
    expect(post).toMatchObject({ kind: "post-hook", name: "PostHookError", retryable: false });
    expect(ErrorClassifier.classify(new AuditError("Account", "create")).kind).toBe("audit");
    expect(ErrorClassifier.classify(new EachAsyncError([new Error("x")])).kind).toBe("each-async");
  });

  test("isDuplicateKey is true only for a duplicate key error; hasDuplicateKey also looks into a bulk error", () => {
    const dup = ErrorTranslator.wrap(server({ code: 11000 })) as DuplicateKeyError;
    const bulk = new BulkWriteError(
      "insertMany",
      [{ index: 0, code: 11000, message: "dup", error: dup }],
      {
        insertedCount: 0,
        matchedCount: 0,
        modifiedCount: 0,
        deletedCount: 0,
        upsertedCount: 0,
        insertedIds: {},
        upsertedIds: {},
      },
      true,
    );
    expect(ErrorClassifier.isDuplicateKey(dup)).toBe(true);
    expect(ErrorClassifier.isDuplicateKey(bulk)).toBe(false);
    expect(ErrorClassifier.hasDuplicateKey(bulk)).toBe(true);
  });
});

describe("the public ErrorClassifier holds only classify and the predicates", () => {
  test("its static members are classify, isDuplicateKey, hasDuplicateKey, isRetryable, isTransient, isTimeout", async () => {
    const own = Object.getOwnPropertyNames(ErrorClassifier)
      .filter((name) => !["length", "name", "prototype"].includes(name))
      .filter((name) => typeof Reflect.get(ErrorClassifier, name) === "function")
      .sort();
    expect(own).toEqual(
      ["classify", "hasDuplicateKey", "isDuplicateKey", "isRetryable", "isTimeout", "isTransient", "kindOf"].sort(),
    );
    expect(Object.getOwnPropertySymbols(ErrorClassifier)).toEqual([]);
    const entry = await import("../../../src/index.ts");
    expect("ErrorTranslator" in entry).toBe(false);
    expect(entry.ErrorClassifier).toBe(ErrorClassifier);
  });
});
