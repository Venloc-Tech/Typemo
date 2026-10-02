$populate<
  const Ps = never,
  const Pa extends PopulatePathHint<T> = never,
  const S = undefined,
  const O extends PopulateObjectSpec<T, Pa, S> = PopulateObjectSpec<T, Pa, S>,
  const L = never,
>(
  arg: PopulateArgument<T, Ps, Pa, S, O, L>,
): Promise<
  ReshapedDocument<
    B,
    P,
    ApplyPopulate<T, PopulateArgumentEntries<Ps, Pa, O, L>, false>,
    PopulatedKeys<T, PopulateArgumentEntries<Ps, Pa, O, L>>
  >
>;
