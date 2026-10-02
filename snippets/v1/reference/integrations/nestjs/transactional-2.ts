const Transactional: (options?: TransactionalOptions) =>
  <M extends (...args: never[]) => Promise<unknown>>(target: object, key: string | symbol, descriptor: TypedPropertyDescriptor<M>) => TypedPropertyDescriptor<M>;

type TransactionalOptions = TransactionalOwnOptions | TransactionalJoinOptions;

interface TransactionalOwnOptions extends TransactionOptions {
  readonly client?: string;
  readonly join?: false;
}

interface TransactionalJoinOptions {
  readonly client?: string;
  readonly join: true;
  readonly readConcern?: never;
  readonly writeConcern?: never;
  readonly timeoutMS?: never;
  readonly maxCommitTimeMS?: never;
}
