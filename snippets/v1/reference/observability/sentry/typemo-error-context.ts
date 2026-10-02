interface TypemoErrorContext {
  readonly [key: string]: unknown;
  readonly model?: string;
  readonly collection?: string;
  readonly database: string;
  readonly connection: string;
  readonly operation: string;
  readonly path: string | undefined;
  readonly failedStep: string | undefined;
  readonly classification: string;
  readonly serverCode: number | undefined;
  readonly errorLabels: readonly string[];
  readonly retryable: boolean;
  readonly transient: boolean;
  readonly tenant?: string;
}
