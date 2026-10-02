project<const P extends { readonly [K in DocPaths<T> | "_id"]?: 0 | 1 | boolean }>(
  spec: P & Exact<P, { readonly [K in DocPaths<T> | "_id"]?: 0 | 1 | boolean }> & MixedProjection<P>,
): PipelineBuilder<ApplyProject<T, P>, M, "staged">
