updateMany<F extends Filter<T, true>, const U extends Update<T, true>>(
  filter: F & NoInfer<WriteFilterCheck<T, F, "many">>,
  update: U & NoInfer<UpdateCheck<T, U>>,
  options?: NoInfer<UpdateOptions<T, U>>,
): WriteBuilder<UpdateResult<IdOf<T>>>;
updateMany<F extends Filter<T, true>>(
  filter: F & NoInfer<WriteFilterCheck<T, F, "many">>,
  pipeline: UpdatePipelineFor<T>,
  options?: PipelineUpdateOptions,
): WriteBuilder<UpdateResult<IdOf<T>>>;
