findOne<F extends Filter<T, true>>(
  filter?: F & NoInfer<FilterCheck<T, F>>,
): QueryBuilder<T, "findOne", undefined, never, false, false, NoNarrowing, never>
