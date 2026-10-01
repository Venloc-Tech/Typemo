/*
 * Turns the errors of Typemo and of the raw driver into HTTP answers by `ErrorClassifier.classify`. The answer never
 * carries the server's text, hosts or stored values: a duplicate key answers with the field names only (the values
 * may be hidden or sensitive), a cast or strict error with the path, a validation error with the messages of its
 * issues (the core masks the values of sensitive fields in them). Everything a 500 hides goes to the log.
 */
import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from "@nestjs/common";
import {
  CastError,
  type ErrorClassification,
  ErrorClassifier,
  PostHookError,
  StrictModeError,
  TypemoError,
  ValidationError,
} from "@venloc/typemo";
import { MongoError } from "mongodb";

/**
 * The HTTP answer for an error.
 *
 * @example
 * ```ts
 * const answer: TypemoHttpResponse = { status: 404, body: { statusCode: 404, error: "Not Found", message: "Not found" } };
 * ```
 */
export interface TypemoHttpResponse {
  /** The HTTP status. */
  readonly status: number;
  /** The JSON body. */
  readonly body: Readonly<Record<string, unknown>>;
}

/** The status texts of the answers the filter makes. */
const STATUS_TEXT: Readonly<Record<number, string>> = {
  400: "Bad Request",
  404: "Not Found",
  409: "Conflict",
  422: "Unprocessable Entity",
  500: "Internal Server Error",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

/**
 * The answer body: `{ statusCode, error, message }` (the shape of Nest's own HTTP errors) plus details.
 *
 * @param status - The status.
 * @param message - The message.
 * @param details - More fields.
 * @returns The answer.
 */
const answer = (
  status: number,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): TypemoHttpResponse => ({
  status,
  body: { statusCode: status, error: STATUS_TEXT[status] ?? "Error", message, ...details },
});

/**
 * The exception filter of Typemo errors (and of raw `mongodb` errors, e.g. from `client.unsafeDriver()`), HTTP only
 * (Express). Register it with `app.useGlobalFilters(new TypemoExceptionFilter())`, `{ provide: APP_FILTER, useClass:
 * TypemoExceptionFilter }` or `@UseFilters(TypemoExceptionFilter)`; override `toResponse` to change an answer.
 *
 * @example
 * ```ts
 * const filter = new TypemoExceptionFilter();
 * const { status } = filter.toResponse(new Error("boom"), ErrorClassifier.classify(new Error("boom"))); // 500
 * ```
 */
@Catch(TypemoError, MongoError)
export class TypemoExceptionFilter implements ExceptionFilter {
  /** Where the hidden details of 500 answers go. */
  readonly logger = new Logger("TypemoExceptionFilter");

  /**
   * The answer for an error: duplicate key 409, validation 422 (also the server's validator), cast and strict 400,
   * not found 404, version and write conflict 409, a transient transaction error 503, no connection 503, timeout 504,
   * anything else 500 (also a `PostHookError`: the write was applied, a hook after it failed).
   *
   * @param error - The thrown error.
   * @param classification - What `ErrorClassifier.classify` said about it.
   * @returns The status and the body.
   */
  toResponse(error: unknown, classification: ErrorClassification): TypemoHttpResponse {
    switch (classification.kind) {
      case "duplicate-key": {
        const key =
          (error as { keyPattern?: unknown; keyValue?: unknown }).keyPattern ??
          (error as { keyValue?: unknown }).keyValue;
        const fields = typeof key === "object" && key !== null ? Object.keys(key) : [];
        return answer(409, "Duplicate value", { fields });
      }
      case "bulk-write":
        return ErrorClassifier.hasDuplicateKey(error)
          ? answer(409, "Duplicate value")
          : answer(500, "Internal server error");
      case "validation": {
        const errors: Record<string, string> = {};
        for (const issue of error instanceof ValidationError ? error.issues : []) {
          const path = issue.path.join(".");
          errors[path] ??= issue.message;
        }
        return answer(422, "Validation failed", { errors });
      }
      case "server-validation":
        return answer(422, "Validation failed");
      case "cast":
        return answer(400, "Invalid value", error instanceof CastError ? { path: error.path } : {});
      case "strict":
        return answer(
          400,
          "Not allowed",
          error instanceof StrictModeError
            ? { reason: error.reason, ...(error.path === undefined ? {} : { path: error.path }) }
            : {},
        );
      case "not-found":
        return answer(404, "Not found");
      case "version":
      case "write-conflict":
        return answer(409, "The document was changed by someone else");
      case "timeout":
        return answer(504, "The database took too long");
      case "connection":
        return answer(503, "The database is unavailable");
      default:
        return classification.transient ? answer(503, "Try again") : answer(500, "Internal server error");
    }
  }

  /**
   * Sends the answer; logs the error of a 500 answer (a `PostHookError` marked as applied).
   *
   * @param error - The thrown error.
   * @param host - The arguments host.
   * @throws The error itself in a context other than HTTP.
   */
  catch(error: TypemoError | MongoError, host: ArgumentsHost): void {
    if (host.getType() !== "http") throw error;
    const { status, body } = this.toResponse(error, ErrorClassifier.classify(error));
    if (status >= 500) {
      const applied = error instanceof PostHookError ? " (the write was applied)" : "";
      this.logger.error(`${error.name}${applied}: ${error.message}`, error.stack);
    }
    const response = host.switchToHttp().getResponse<{ status(code: number): { json(body: unknown): void } }>();
    response.status(status).json(body);
  }
}
