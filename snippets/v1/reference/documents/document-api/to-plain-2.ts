$toPlain<const O extends ToObjectOptions, R>(
  options: O & MaskOptionCheck<ToPlainBase<T, O>, O> & { readonly transform: (plain: ToPlainResult<T, O>) => R },
): R;
$toPlain<const O extends ToObjectOptions = Record<never, never>>(
  options?: O & MaskOptionCheck<ToPlainBase<T, O>, O>,
): ToPlainResult<T, O>;
