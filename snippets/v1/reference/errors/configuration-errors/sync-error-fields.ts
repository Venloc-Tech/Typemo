class SyncError extends TypemoError {
  readonly operation: "connection.init" | "syncAll";
  readonly failures: readonly SyncFailure[];
  readonly errors: readonly TypemoError[];
  readonly report: SyncReport;
}

interface SyncFailure {
  readonly kind: "collection" | "view";
  readonly name: string;
  readonly model: string | undefined;
  readonly errors: readonly TypemoError[];
}
