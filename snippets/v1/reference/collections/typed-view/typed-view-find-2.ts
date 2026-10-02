find<F extends Filter<V, true>>(
  filter?: F & NoInfer<FilterCheck<V, F>>,
): QueryBuilder<V, "find", undefined, never, true, false, NoNarrowing, never>
