type StrictModeReason =
  | "unknown-path" | "not-hidden" | "undefined" | "empty-filter" | "empty-logical" | "empty-update"
  | "immutable" | "limit" | "sanitize" | "tenant" | "soft-delete" | "transaction-option" | "concurrent-session";

class StrictModeError extends TypemoError {
  readonly reason: StrictModeReason;
  readonly path: string | undefined;
}
