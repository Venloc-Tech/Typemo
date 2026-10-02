insertMany(docs: readonly CreateInput<T>[], options?: InsertManyOptions): Promise<NewDocument<T>[]>

interface InsertManyOptions extends WriteOptions {
  readonly ordered?: boolean;
}
