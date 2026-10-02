updateOne<F extends Filter<T, true>, const U extends Update<T, true>>(
  filter: F & NoInfer<WriteFilterCheck<T, F, "one">>,
  update: U & NoInfer<UpdateCheck<T, U>>,
  options?: NoInfer<UpdateOptions<T, U>>,
): WriteBuilder<UpdateResult<IdOf<T>>>;
updateOne<F extends Filter<T, true>>(
  filter: F & NoInfer<WriteFilterCheck<T, F, "one">>,
  pipeline: UpdatePipelineFor<T>,
  options?: PipelineUpdateOptions,
): WriteBuilder<UpdateResult<IdOf<T>>>;
