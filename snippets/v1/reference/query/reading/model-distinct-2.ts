distinct<const P extends FilterPaths<T>, F extends Filter<T, true>>(
  path: P,
  filter?: F & NoInfer<FilterCheck<T, F>>,
): OptionQuery<DistinctValue<T, P>[]>
