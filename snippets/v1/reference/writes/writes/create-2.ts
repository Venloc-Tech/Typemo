create(doc: CreateInput<T>, options?: WriteOptions): Promise<NewDocument<T>>;
create(docs: readonly CreateInput<T>[], options?: WriteOptions): Promise<NewDocument<T>[]>;
