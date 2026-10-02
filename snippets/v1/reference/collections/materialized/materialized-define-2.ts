static define<Target extends abstract new () => object, const Src extends EntityClass, R extends StagedPipeline>(
  connection: Connection,
  target: Target,
  definition: {
    readonly from: Src;
    readonly pipeline: (p: PipelineBuilder<DocOf<Src>, "collection", "empty">) => R & MaterializedRowCheck<…>;
  } & MaterializedWrite<InstanceType<Target>>,
): Materialized<InstanceType<Target>>
