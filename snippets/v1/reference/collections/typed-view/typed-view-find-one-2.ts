findOne<F extends Filter<V, true>>(
  filter?: F & NoInfer<FilterCheck<V, F>>,
): QueryBuilder<V, "findOne", undefined, never, true, false, NoNarrowing, never>
