find<F extends Filter<T, true>>(
  filter?: F & NoInfer<FilterCheck<T, F>>,
): QueryBuilder<T, "find", undefined, never, false, false, NoNarrowing, never>
