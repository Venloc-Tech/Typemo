const Schema: <const O extends SchemaOptions = Record<never, never>>(
  options?: O,
) => <C extends EntityClass>(target: C & SchemaCheck<C, O>) => void
