interface OperationHookContext<T, E extends OperationHookEvent = OperationHookEvent> {
  readonly event: E;
  readonly operation: string;
  readonly model: string;
  readonly operationId: number;
  readonly filter: Readonly<Record<string, unknown>> | undefined;
  readonly update: Readonly<Record<string, unknown>> | readonly Readonly<Record<string, unknown>>[] | undefined;
  readonly replacement: Readonly<Record<string, unknown>> | undefined;
  readonly documents: readonly Readonly<Record<string, unknown>>[] | undefined;
  readonly operations: readonly Readonly<Record<string, unknown>>[] | undefined;
  readonly pipeline: readonly Readonly<Record<string, unknown>>[] | undefined;
  readonly session: ClientSession | undefined;
  readonly inTransaction: boolean;
  readonly policy: Readonly<PolicyValues>;
  readonly locals: Map<string, unknown>;
  readonly bulkIndex?: number | undefined;
  skip(result: SkipResult<E, T>): void;
  modify(change: OperationChange<T, E>): void;
}
