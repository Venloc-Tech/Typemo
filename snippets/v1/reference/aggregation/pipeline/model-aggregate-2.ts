aggregate<B extends AggregateResult>(
  build: AggregateBuild<T, B>,
  options?: ModelAggregateOptions,
): AggregateQuery<AggregateRows<B>>;
aggregate<R>(plan: AggregatePlan<R>, options?: ModelAggregateOptions): AggregateQuery<R>;
