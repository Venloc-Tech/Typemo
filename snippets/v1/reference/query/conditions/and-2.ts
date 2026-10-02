and<C extends NonEmptyArray<Filter<T, true>>>(
  clauses: C & NoInfer<FilterCheck<T, { $and: C }>>,
): QueryBuilder<T, Op, S, E, Form, Found, N, X>
