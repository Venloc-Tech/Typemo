findOneAndDelete<F extends Filter<T, true>>(
  filter: F & NoInfer<WriteFilterCheck<T, F, "one">>,
): QueryBuilder<T, "findOneAndDelete", undefined, never, false, false, NoNarrowing, never>
