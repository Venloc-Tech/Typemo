bulkWrite(
  operations: readonly BulkWriteOperation<T>[],
  options?: BulkWriteOptions,
): Promise<BulkWriteResultOf<T>>

interface BulkWriteOptions extends WriteOptions {
  readonly ordered?: boolean;
}
