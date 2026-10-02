replaceOne<F extends Filter<T, true>>(
  filter: F & NoInfer<WriteFilterCheck<T, F, "one">>,
  replacement: Replacement<T>,
  options?: ReplaceOptions,
): WriteBuilder<UpdateResult<IdOf<T>>>

interface ReplaceOptions {
  readonly upsert?: boolean;
}
