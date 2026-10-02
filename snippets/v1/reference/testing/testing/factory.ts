type FactoryOverrides<T> = Partial<CreateInput<T>> | ((n: number) => Partial<CreateInput<T>>);

interface FactoryModel<T> {
  readonly entity: abstract new () => T;
  create(doc: NoInfer<CreateInput<T>>): Promise<NewDocument<T>>;
}

interface Factory<T> {
  build(overrides?: FactoryOverrides<T>): CreateInput<T>;
  buildMany(count: number, overrides?: FactoryOverrides<T>): CreateInput<T>[];
  create(overrides?: FactoryOverrides<T>): Promise<NewDocument<T>>;
  createMany(count: number, overrides?: FactoryOverrides<T>): Promise<NewDocument<T>[]>;
  reset(): void;
}
