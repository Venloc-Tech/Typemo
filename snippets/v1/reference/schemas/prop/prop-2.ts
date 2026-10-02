const Prop: <const S extends TypeSpec, const O extends PropOptions<S>>(
  type: () => S,
  options?: O & NoExtraOptions<O, PropOptions<S>>,
) => PropDecorator<S, O>
