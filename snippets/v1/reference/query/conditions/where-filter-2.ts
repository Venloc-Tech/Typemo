where<F extends Filter<T, true>>(
  filter: F & NoInfer<FilterCheck<T, F>>,
): QueryBuilder<T, Op, S, E, Form, Found, N, X>
