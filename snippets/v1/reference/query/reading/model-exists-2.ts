exists<F extends Filter<T, true>>(
  filter: F & NoInfer<FilterCheck<T, F>>,
): OptionQuery<{ _id: IdOf<T> } | null>
