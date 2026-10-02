mask<const Sp extends object>(
  spec: Sp & MaskSpecCheck<Row, Sp>,
): MaskedQuery<ApplyMask<Row, Sp>[], ApplyMask<Row, Sp>, true>
