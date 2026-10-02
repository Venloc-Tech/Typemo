findOneAndReplace<F extends Filter<T, true>, const O extends FindOneAndReplaceOptions = Record<never, never>>(
  filter: F & NoInfer<WriteFilterCheck<T, F, "one">>,
  replacement: Replacement<T>,
  options?: O,
): QueryBuilder<T, "findOneAndReplace", undefined, never, false, UpsertFound<O>, NoNarrowing, never>

interface FindOneAndReplaceOptions extends ReplaceOptions {
  readonly returnDocument?: "before" | "after";
}
