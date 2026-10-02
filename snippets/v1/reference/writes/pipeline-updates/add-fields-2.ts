addFields<const F extends Record<string, unknown>>(
  builder: (f: FieldProxy<T>) => F & InvalidPathKeys<T, F> & ExprValues<F>,
): PipelineBuilder<ApplyFields<T, F>, M, "staged">
