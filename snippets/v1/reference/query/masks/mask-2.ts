mask<const Sp extends object>(
  this: RowsOnly<Form, unknown, "mask() masks rows: call .lean() or .plain() first — …">,
  spec: Sp & MaskSpecCheck<ResultDoc<T, S, E, Form, N, X>, Sp>,
): MaskedQuery<
  QueryResult<Many<Op>, Found, ApplyMask<ResultDoc<T, S, E, Form, N, X>, Sp>>,
  ApplyMask<ResultDoc<T, S, E, Form, N, X>, Sp>,
  Many<Op>
>
