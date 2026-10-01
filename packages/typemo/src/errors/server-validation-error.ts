import { ServerError, type ServerErrorDetails } from "./server-error.ts";

/** The collection's validator (`$jsonSchema`) refused a document (server code 121). */
export class ServerValidationError extends ServerError {
  /** The server's explanation (`errInfo.details`: which rule failed on which field). */
  readonly errInfo: Readonly<Record<string, unknown>> | undefined;

  /**
   * @param message - Human-readable description.
   * @param details - The common server error details plus the server's `errInfo`.
   */
  constructor(
    message: string,
    details: ServerErrorDetails & { readonly errInfo: Readonly<Record<string, unknown>> | undefined },
  ) {
    super(message, details);
    this.errInfo = details.errInfo;
  }

  static {
    Object.defineProperty(ServerValidationError.prototype, "name", {
      value: "ServerValidationError",
      writable: true,
      configurable: true,
    });
  }
}
