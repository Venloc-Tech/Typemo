interface OperationInfo {
  readonly operationId: number;
  readonly parentId: number | undefined;
  readonly operation: OperationName;
  readonly mode: ExecutionMode;
  readonly model: string | null;
  readonly collection: string | null;
  readonly database: string;
  readonly connection: string;
  readonly inTransaction: boolean;
  readonly transactionId: number | undefined;
  readonly serverAddress: string | undefined;
  readonly serverPort: number | undefined;
  readonly populatePath: string | undefined;
  readonly schema: SchemaInfo | null;
  readonly tenant?: unknown;
}
