populate<
  const Ps = never,
  const Pa extends PopulatePathHint<T> = never,
  const Sel = undefined,
  const O extends PopulateObjectSpec<T, Pa, Sel> = PopulateObjectSpec<T, Pa, Sel>,
  const L = never,
>(
  arg: PopulateArgument<T, Ps, Pa, Sel, O, L>,
): IsAny<Ps> extends true
  ? PathError<"populate(): the argument is typed any; give it a type (a path literal, a list of paths or a populate object)">
  : QueryBuilder<T, Op, S, ReplaceEntries<E, PopulateArgumentEntries<Ps, Pa, O, L>>, Form, Found, N, X>;
