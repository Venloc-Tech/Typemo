unset<const U extends DocPaths<T> | readonly [DocPaths<T>, ...DocPaths<T>[]]>(
  fields: U,
): PipelineBuilder<ApplyUnset<T, U>, M, "staged">
