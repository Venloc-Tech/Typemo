static define<View extends abstract new () => object, const Src extends SourceInput, R extends StagedPipeline>(
  connection: Connection,
  view: View,
  definition: TypedViewDefinition<Src, R> & { readonly pipeline: (…) => R & ViewRowCheck<…> },
): TypedView<InstanceType<View>>
