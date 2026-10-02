class TypemoError extends Error {
  constructor(message: string, options?: TypemoErrorOptions);
}

interface TypemoErrorOptions {
  readonly cause?: unknown;
}
