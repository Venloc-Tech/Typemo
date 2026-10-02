const Index: <const F extends IndexFields, const O extends IndexOptions = Record<never, never>>(
  fields: F,
  options?: O,
) => <C extends EntityClass>(target: C & IndexCheck<C, F, O>) => void
