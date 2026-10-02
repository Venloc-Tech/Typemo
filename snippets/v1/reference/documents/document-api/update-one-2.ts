$updateOne<const U extends Update<T, true>>(
  update: U & NoInfer<UpdateCheck<T, U>>,
  options?: SaveOptions,
): Promise<UpdateResult<IdOf<T>>>;
