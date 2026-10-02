static view<View extends abstract new () => object, const Src extends SourceInput, R extends StagedPipeline>(
  view: View,
  definition: TypedViewDefinition<Src, R> & { readonly pipeline: (p) => R & ViewRowCheck<…> },
): ViewFeature<InstanceType<View>>
