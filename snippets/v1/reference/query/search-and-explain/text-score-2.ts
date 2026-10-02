textScore<const Name extends string = "score">(
  name?: Name,
  options?: { readonly sort?: boolean },
): QueryBuilder<T, Op, S, E, Form, Found, N & { readonly [K in Name]: number }, X>
