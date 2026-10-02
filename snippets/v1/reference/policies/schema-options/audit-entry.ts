interface AuditEntry {
  readonly at: Date;
  readonly model: string;
  readonly collection: string;
  readonly operation: string;
  readonly document: boolean;
  readonly actor?: unknown;
  readonly tenant?: unknown;
  readonly filter?: PlanDocument;
  readonly update?: PlanDocument | readonly PlanDocument[];
  readonly replacement?: PlanDocument;
  readonly documents?: readonly PlanDocument[];
  readonly operations?: readonly PlanDocument[];
  readonly result: Readonly<Record<string, unknown>>;
  readonly outcome: "ok" | "partial";
  readonly softDelete?: true;
}
