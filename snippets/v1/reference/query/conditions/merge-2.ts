merge(source: QueryOf<T>): QueryBuilder<T, Op, S, E, Form, Found, N, X>
merge<F extends Filter<T, true>>(
  source: F & NoInfer<FilterCheck<T, F>>,
): QueryBuilder<T, Op, S, E, Form, Found, N, X>
