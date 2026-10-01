/* The public API of the operation pipeline, re-exported by `src/index.ts` in one line. Only the names that appear in
   events, hooks and options are public. The pipeline itself, its steps, `PassThroughStep` and `DriverExecutor` live
   in `src/internal.ts`: replacing a slot could drop the `policies` slot (tenant, soft delete, Hidden, sanitize,
   strict). */
export type {
  AggregateExecutionPlan,
  BulkWriteModel,
  ExecutionMode,
  OperationName,
  WatchOptions,
} from "./pipeline/execution-plan.ts";
export type { PreStepName, StepName } from "./pipeline/operation-step.ts";
