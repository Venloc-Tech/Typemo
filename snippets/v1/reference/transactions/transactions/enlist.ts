class TransactionScope {
  static current(): TransactionScope | undefined;
  readonly id: number;
  readonly session: ClientSession;
  readonly owner: object;
  readonly timeoutMS: number | undefined;
  readonly startedAt: number;
  get attempt(): number;
  get participants(): readonly TransactionParticipant[];
  enlist(participant: TransactionParticipant): void;
}

interface TransactionParticipant {
  readonly onRetry?: () => void | Promise<void>;
  readonly onAbort?: () => void | Promise<void>;
  readonly onCommit?: () => void | Promise<void>;
}
