static from<const Src extends SourceInput, const Inc extends HiddenOf<Src> = never>(
  source: Src,
  options?: AggregateOptions<DocOf<Src>> & { readonly include?: readonly Inc[] },
): PipelineBuilder<DocOf<Src, Inc>, "collection", "empty">
