static view<View extends abstract new () => object, const Src extends SourceInput, R extends StagedPipeline>(
  _view: View,
  definition: {
    readonly on: Src;
    readonly pipeline: (p: PipelineBuilder<DocOf<Src>, "view", "empty">) => ViewPipelineCheck<R, InstanceType<View>>;
  },
): ViewDefinition
