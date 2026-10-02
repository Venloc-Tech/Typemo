findByIdAndUpdate<
  const U extends Update<T, true>,
  const O extends FindOneAndUpdateOptions<T, U> = Record<never, never>,
>(
  id: IdInputOf<T>,
  update: U & NoInfer<UpdateCheck<T, U>>,
  options?: O & NoInfer<FindOneAndUpdateOptions<T, U>>,
): QueryBuilder<T, "findOneAndUpdate", undefined, never, false, UpsertFound<O>, NoNarrowing, never>
