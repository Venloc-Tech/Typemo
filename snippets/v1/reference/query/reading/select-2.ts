select<const P extends Projection<T> & { readonly [key: string]: unknown }>(
  projection: P & ProjectionCheck<T, P>,
): QueryBuilder<T, Op, MergeProjection<S, AnyProjection<P>>, E, Form, Found, N, X>
