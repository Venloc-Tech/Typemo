class PostHookError extends TypemoError {
  readonly model: string;
  readonly operation: string;
  readonly applied: true;
  readonly result: unknown;
  constructor(model: string, operation: string, result: unknown, options?: TypemoErrorOptions);
}
