nor<C extends NonEmptyArray<Filter<T, true>>>(
  clauses: C & NoInfer<FilterCheck<T, { $nor: C }>>,
): QueryBuilder<T, Op, S, E, Form, Found, N, X>
