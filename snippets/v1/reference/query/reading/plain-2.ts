plain(): QueryBuilder<T, Op, S, E, "plain", Found, N, X>
plain<const O extends PlainReadOptions>(
  options: O,
): QueryBuilder<T, Op, S, E, O extends { readonly hidden: true } ? "plain+hidden" : "plain", Found, N, X>
