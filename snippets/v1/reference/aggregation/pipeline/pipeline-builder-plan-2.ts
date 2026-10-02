interface AggregatePlan<Row> {
  readonly op: "aggregate";
  readonly target: PipelineTarget;
  readonly pipeline: readonly PipelineStage[];
  readonly options: AggregateOptions<unknown>;
}
