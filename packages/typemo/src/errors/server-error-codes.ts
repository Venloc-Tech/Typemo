/**
 * Server error codes Typemo reacts to, by name. The driver exports no constant for most of them (not even
 * 11000), so they are listed here.
 *
 * @example
 * ```ts
 * declare const error: ServerError;
 * if (error.code === ServerErrorCodes.DuplicateKey) console.log("a duplicate", error.codeName);
 * ```
 */
export const ServerErrorCodes = Object.freeze({
  HostUnreachable: 6,
  HostNotFound: 7,
  Unauthorized: 13,
  AuthenticationFailed: 18,
  IllegalOperation: 20,
  NamespaceNotFound: 26,
  PathNotViable: 28,
  CursorNotFound: 43,
  NamespaceExists: 48,
  MaxTimeMSExpired: 50,
  ConflictingUpdateOperators: 40,
  WriteConcernTimeout: 64,
  IndexOptionsConflict: 85,
  IndexKeySpecsConflict: 86,
  NetworkTimeout: 89,
  ShutdownInProgress: 91,
  WriteConflict: 112,
  ConflictingOperationInProgress: 117,
  DocumentValidationFailure: 121,
  CappedPositionLost: 136,
  PrimarySteppedDown: 189,
  IncompleteTransactionHistory: 217,
  NoSuchTransaction: 251,
  TransactionCommitted: 256,
  TransactionTooLarge: 257,
  ExceededTimeLimit: 262,
  ChangeStreamFatalError: 280,
  ChangeStreamHistoryLost: 286,
  DuplicateKey: 11000,
  InterruptedAtShutdown: 11600,
  InterruptedDueToReplStateChange: 11602,
  NotWritablePrimary: 10107,
  SearchNotEnabled: 31082,
} as const);

/**
 * A known server error code.
 *
 * @example
 * ```ts
 * const code: ServerErrorCode = 11000;
 * ```
 */
export type ServerErrorCode = (typeof ServerErrorCodes)[keyof typeof ServerErrorCodes];

/**
 * Error labels the server and the driver attach (the driver's `MongoErrorLabel`).
 *
 * @example
 * ```ts
 * declare const error: ServerError;
 * if (error.errorLabels.includes(ErrorLabels.TransientTransactionError)) console.log("the transaction may be retried");
 * ```
 */
export const ErrorLabels = Object.freeze({
  RetryableWriteError: "RetryableWriteError",
  TransientTransactionError: "TransientTransactionError",
  UnknownTransactionCommitResult: "UnknownTransactionCommitResult",
  ResumableChangeStreamError: "ResumableChangeStreamError",
} as const);
