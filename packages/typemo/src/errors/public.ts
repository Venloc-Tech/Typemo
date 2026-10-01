/**
 * The public API of the error hierarchy, re-exported by `src/index.ts`.
 * `QueryError` is exported by `src/query/public.ts`.
 *
 * @packageDocumentation
 */
export { AuditError } from "./audit-error.ts";
export { BulkWriteError, type BulkWriteFailure, type BulkWriteSummary } from "./bulk-write-error.ts";
export { CastError, type CastErrorDetails, type CastReason } from "./cast-error.ts";
export { ConfigurationError } from "./configuration-error.ts";
export { ConnectionError, type ConnectionFailure } from "./connection-error.ts";
export { DocumentNotFoundError } from "./document-not-found-error.ts";
export { DriverError } from "./driver-error.ts";
export { type DuplicateKeyDetails, DuplicateKeyError } from "./duplicate-key-error.ts";
export { EachAsyncError } from "./each-async-error.ts";
export { type ErrorClassification, ErrorClassifier, type ErrorKind } from "./error-classifier.ts";
export { type IndexFailure, IndexSyncError } from "./index-sync-error.ts";
export { InternalError } from "./internal-error.ts";
export { PostHookError } from "./post-hook-error.ts";
export { ServerError, type ServerErrorDetails } from "./server-error.ts";
export { ErrorLabels, type ServerErrorCode, ServerErrorCodes } from "./server-error-codes.ts";
export { ServerValidationError } from "./server-validation-error.ts";
export { StrictModeError, type StrictModeReason } from "./strict-mode-error.ts";
export { TimeoutError, type TimeoutKind } from "./timeout-error.ts";
export { TypemoError, type TypemoErrorOptions } from "./typemo-error.ts";
export { type SchemaIssue, ValidationError, type ValidationReason } from "./validation-error.ts";
export { VersionError } from "./version-error.ts";
export { WriteConflictError } from "./write-conflict-error.ts";
