type ViewPipelineCheck<R, V> = [ViewRowProblems<ViewRowsOf<R>, V>] extends [never]
  ? R
  : PathError<"…">
