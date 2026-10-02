bulkSave(
  documents: readonly SavableDocument[],
  options?: SaveOptions,
): Promise<BulkWriteResultOf<T> | undefined>
