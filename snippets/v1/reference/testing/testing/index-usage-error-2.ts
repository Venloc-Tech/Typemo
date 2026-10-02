class IndexUsageError extends TypemoError {
  readonly usage: IndexUsage;
  constructor(message: string, usage: IndexUsage, options?: TypemoErrorOptions);
}
