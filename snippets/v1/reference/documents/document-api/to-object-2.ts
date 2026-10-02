$toObject<const O extends ToObjectOptions, R>(
  options: O & MaskOptionCheck<ToObjectBase<T, O>, O> & { readonly transform: (plain: ToObjectResult<T, O>) => R },
): R;
$toObject<const O extends ToObjectOptions = Record<never, never>>(
  options?: O & MaskOptionCheck<ToObjectBase<T, O>, O>,
): ToObjectResult<T, O>;
