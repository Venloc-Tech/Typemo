replaceWith<const R extends Arg<{ readonly [key: string]: unknown }>>(
  builder: (f: FieldProxy<T>) => R,
): PipelineBuilder<Simplify<NonNullable<UnwrapDeep<R>>>, M, "staged">
