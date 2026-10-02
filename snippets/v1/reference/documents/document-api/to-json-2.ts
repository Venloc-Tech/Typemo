$toJSON<const O extends ToObjectOptions, R>(
  options: O & MaskOptionCheck<ToJsonBase<T, O>, O> & { readonly transform: (json: ToJsonResult<T, O>) => R },
): R;
$toJSON<const O extends ToObjectOptions = Record<never, never>>(
  options?: O & MaskOptionCheck<ToJsonBase<T, O>, O>,
): ToJsonResult<T, O>;
