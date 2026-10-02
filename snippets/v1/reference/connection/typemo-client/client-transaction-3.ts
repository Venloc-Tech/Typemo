transaction<R>(fn: TransactionCallback<R>, options?: TransactionOptions): Promise<R>

type TransactionCallback<R> = (scope: TransactionScope) => Promise<R>
