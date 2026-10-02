distinct<const P extends FilterPaths<V>, F extends Filter<V, true>>(
  path: P,
  filter?: F & NoInfer<FilterCheck<V, F>>,
): OptionQuery<DistinctValue<V, P>[]>
