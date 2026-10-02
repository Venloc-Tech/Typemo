class ErrorClassifier {
  static classify(error: unknown): ErrorClassification;
  static isDuplicateKey(error: unknown): error is DuplicateKeyError;
  static hasDuplicateKey(error: unknown): boolean;
  static isRetryable(error: unknown): boolean;
  static isTransient(error: unknown): boolean;
  static isTimeout(error: unknown): error is TimeoutError;
}

interface ErrorClassification {
  readonly kind: ErrorKind;
  readonly name: string;
  readonly code: number | undefined;
  readonly errorLabels: readonly string[];
  readonly retryable: boolean;
  readonly transient: boolean;
}
