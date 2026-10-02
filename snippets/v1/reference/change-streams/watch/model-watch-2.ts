watch<const O extends ModelWatchOptions<HiddenPaths<T>> = Record<never, never>>(
  build: (pipeline: WatchBuilder<T>) => WatchBuilder<T> | PipelineBuilder<RowOf<WatchBuilder<T>>, "watch", "staged">,
  options?: O,
): NoInfer<Promise<ModelChangeStream<ChangeEvent<T, O>>>>;

watch<B extends WatchResult, const O extends ModelWatchOptions<HiddenPaths<T>> = Record<never, never>>(
  build: (pipeline: WatchBuilder<T>) => B,
  options?: O,
): NoInfer<Promise<ModelChangeStream<WatchRows<T, B, O>>>>;

watch<const O extends ModelWatchOptions<HiddenPaths<T>> = Record<never, never>>(
  options?: O,
): NoInfer<Promise<ModelChangeStream<ChangeEvent<T, O>>>>;
