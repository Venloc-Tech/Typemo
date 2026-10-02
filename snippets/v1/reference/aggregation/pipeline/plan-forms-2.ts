interface AggregatePlan<Row> {
  readonly op: "aggregate";
  readonly target: PipelineTarget;
  readonly pipeline: readonly PipelineStage[];
  readonly options: AggregateOptions<unknown>;
}

interface AggregateExecutionPlan {
  readonly op: "aggregate";
  readonly entity: EntityClass;
  readonly pipeline: readonly PipelineStage[];
  readonly aggregateOptions: AggregateOptions<unknown>;
  readonly options: PlanOptions;
}
