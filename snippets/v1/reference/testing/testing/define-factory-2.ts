const defineFactory: <T extends object>(
  model: FactoryModel<T>,
  defaults: (n: number) => CreateInput<T>,
) => Factory<T>;
