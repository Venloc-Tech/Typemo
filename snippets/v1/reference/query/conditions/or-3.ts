or<C extends NonEmptyArray<Filter<T, true>>>(
  clauses: C & NoInfer<FilterCheck<T, { $or: C }>>,
): QueryBuilder<T, Op, S, E, Form, Found, N, X>
