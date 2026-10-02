static watch<const Src extends SourceInput>(
  source: Src,
): PipelineBuilder<ChangeStreamDocument<…>, "watch", "empty">
