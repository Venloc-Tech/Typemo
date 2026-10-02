class ServerError extends TypemoError {
  readonly code: number | undefined;
  readonly codeName: string | undefined;
  readonly errorLabels: readonly string[];
  readonly serverMessage: string;
  constructor(message: string, details: ServerErrorDetails);
  hasErrorLabel(label: string): boolean;
}
