findOneAndUpdate<
  F extends Filter<T, true>,
  const U extends Update<T, true>,
  const O extends FindOneAndUpdateOptions<T, U> = Record<never, never>,
>(
  filter: F & NoInfer<WriteFilterCheck<T, F, "one">>,
  update: U & NoInfer<UpdateCheck<T, U>>,
  options?: O & NoInfer<FindOneAndUpdateOptions<T, U>>,
): QueryBuilder<T, "findOneAndUpdate", undefined, never, false, UpsertFound<O>, NoNarrowing, never>
