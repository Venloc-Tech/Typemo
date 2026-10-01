/**
 * Internal entry: not part of the public API and not listed in `package.json` `exports`.
 *
 * Re-exports the public entry plus the internal mechanics that tests, performance guards and the benchmarks of
 * this monorepo need: the operation pipeline and its steps, the policy classes, the schema compiler and
 * metadata, the casters and the query planners. Nothing here is covered by semver, and integrations
 * (`@venloc/typemo-opentelemetry`, `@venloc/typemo-sentry`) must never import it: what they need is made
 * public deliberately in `src/index.ts`. The public list is pinned by `test/unit/api/public-exports.test.ts`.
 *
 * @packageDocumentation
 */

/* --- aggregation internals --- */
export { ExprCompiler } from "./aggregate/expressions/expr-compiler.ts";
export { PipelineBuilder, SealedPipeline, TerminalPipeline } from "./aggregate/pipeline/pipeline-builder.ts";
export { PipelineSources } from "./aggregate/pipeline/pipeline-source.ts";
/* --- casters --- */
export { ArrayCaster } from "./bson/casters/array-caster.ts";
export { BigIntCaster } from "./bson/casters/big-int-caster.ts";
export { BinaryCaster, type BinaryCasterOptions } from "./bson/casters/binary-caster.ts";
export { BooleanCaster } from "./bson/casters/boolean-caster.ts";
export { DateCaster } from "./bson/casters/date-caster.ts";
export { Decimal128Caster } from "./bson/casters/decimal128-caster.ts";
export { DoubleCaster } from "./bson/casters/double-caster.ts";
export { Int32Caster } from "./bson/casters/int32-caster.ts";
export { MapCaster } from "./bson/casters/map-caster.ts";
export { NullableCaster } from "./bson/casters/nullable-caster.ts";
export { NumberCaster } from "./bson/casters/number-caster.ts";
export { ObjectIdCaster } from "./bson/casters/object-id-caster.ts";
export { RegExpCaster } from "./bson/casters/reg-exp-caster.ts";
export { StringCaster } from "./bson/casters/string-caster.ts";
export {
  SubdocumentCaster,
  type SubdocumentFields,
  type SubdocumentOutput,
} from "./bson/casters/subdocument-caster.ts";
export { TimestampCaster } from "./bson/casters/timestamp-caster.ts";
export {
  type DiscriminatedValidators,
  UnionCaster,
  type UnionMember,
  type UnionValidator,
  type UnionValueCaster,
  type ValidationIssue,
} from "./bson/casters/union-caster.ts";
export { UuidCaster } from "./bson/casters/uuid-caster.ts";
export type { CastOutput, ValueCaster } from "./bson/casters/value-caster.ts";
export { VectorCaster, type VectorCasterOptions } from "./bson/casters/vector-caster.ts";
/* --- change streams, collections, connection, documents, errors, instrumentation --- */
export { ChangeStreams, type PreparedWatch } from "./change-streams/change-streams.ts";
export { type SyncMode, SyncRunner } from "./collections/sync-runner.ts";
export { type ClientAccess, ClientInternals } from "./connection/client-internals.ts";
export { ConnectionInternals, type PipelineAccess } from "./connection/connection-internals.ts";
export { SessionGuard } from "./connection/session-guard.ts";
export { TransactionContext } from "./connection/transaction-context.ts";
export { ErrorTranslator } from "./errors/error-translator.ts";
export * from "./index.ts";
export { InstrumentationHub } from "./instrumentation/instrumentation-hub.ts";
export { DocumentReader } from "./model/document-reader.ts";
export { ModelInternals } from "./model/model-internals.ts";
/* --- operation pipeline and steps --- */
export { DriverExecutor, EXPLAIN_VERBOSITY, type InsertOutcome } from "./operation/executor/driver-executor.ts";
export type {
  AggregateExecutionPlan,
  BulkWritePlan,
  ExecutionPlan,
  InsertPlan,
  WatchPlan,
} from "./operation/pipeline/execution-plan.ts";
export { WRITE_OPERATIONS } from "./operation/pipeline/execution-plan.ts";
export {
  OperationContext,
  type OperationContextInit,
  type OperationEnvironment,
  type OperationTarget,
  type RejectedDocument,
  type ResolvedOptions,
} from "./operation/pipeline/operation-context.ts";
export { OperationPipeline, PassThroughStep, type StepSet } from "./operation/pipeline/operation-pipeline.ts";
export { type OperationStep, STEP_ORDER } from "./operation/pipeline/operation-step.ts";
export { StandardPipeline } from "./operation/pipeline/standard-pipeline.ts";
export { CastStep } from "./operation/steps/cast-step.ts";
export { DbNames } from "./operation/steps/db-names.ts";
export { DefaultsStep } from "./operation/steps/defaults-step.ts";
export { EncodeStep } from "./operation/steps/encode-step.ts";
export { NormalizeStep } from "./operation/steps/normalize-step.ts";
export { PolicyStep } from "./operation/steps/policy-step.ts";
export { ResolvePathsStep } from "./operation/steps/resolve-paths-step.ts";
export type { ResultShape } from "./operation/steps/result-shape.ts";
export { ValidateStep } from "./operation/steps/validate-step.ts";
/* --- plugins, policies --- */
export { PluginRegistry } from "./plugins/plugin-registry.ts";
export { AuditPolicy } from "./policies/audit-policy.ts";
export { EmptyLogicalPolicy } from "./policies/empty-logical-policy.ts";
export { EmptyUpdatePolicy } from "./policies/empty-update-policy.ts";
export { HiddenPolicy } from "./policies/hidden-policy.ts";
export { ImmutablePolicy } from "./policies/immutable-policy.ts";
export { LimitPolicy } from "./policies/limit-policy.ts";
export { RequireFilterPolicy } from "./policies/require-filter-policy.ts";
export { SanitizePolicy } from "./policies/sanitize-policy.ts";
export { SoftDeletePolicy } from "./policies/soft-delete-policy.ts";
export { StrictPathPolicy } from "./policies/strict-path-policy.ts";
export { TenantPolicy } from "./policies/tenant-policy.ts";
export { UndefinedPolicy } from "./policies/undefined-policy.ts";
/* --- query planners --- */
export { ModelOperations } from "./query/model-operations.ts";
export type {
  CursorSource,
  FindMode,
  FindOperation,
  FindPlan,
  ModifyOperation,
  ModifyPlan,
  OperationKind,
  OperationPlan,
  PlanDocument,
  PlanExecutor,
  PlanOptions,
  PlanWriteConcern,
  PopulatePlan,
  QueryCursor,
  SortPair,
  ValueOperation,
  ValuePlan,
  WriteOperation,
  WritePlan,
} from "./query/plan.ts";
export { PlanValues } from "./query/plan-values.ts";
export { PopulateSpecs } from "./query/populate-specs.ts";
export { ProjectionPlanner } from "./query/projection-planner.ts";
export { QuerySpecs } from "./query/query-specs.ts";
export { MaskedQuery, ResponseMask } from "./query/response-mask.ts";
export { type PlannedUpdate, UpdatePlanner } from "./query/update-planner.ts";
export { WriteBuilder } from "./query/write-builder.ts";
/* --- schema compiler and metadata --- */
export { CompiledSchema } from "./schema/compiler/compiled-schema.ts";
export type {
  ArrayNode,
  MapNode,
  NestedNode,
  NodeValidator,
  PathNode,
  ScalarNode,
  SubdocumentNode,
  UnionNode,
} from "./schema/compiler/path-node.ts";
export { type CompileContext, SchemaCompiler } from "./schema/compiler/schema-compiler.ts";
export { SchemaSources } from "./schema/compiler/schema-source.ts";
export { SchemaWalker, type WalkOptions, type WalkResult } from "./schema/compiler/schema-walker.ts";
export { HydrationSupport } from "./schema/entity/hydration-support.ts";
export { IndexHelpers } from "./schema/indexes/index-helpers.ts";
export { MetadataBuilder } from "./schema/metadata/metadata-builder.ts";
export { type MergedMetadata, MetadataStore } from "./schema/metadata/metadata-store.ts";
export type {
  ClassRecord,
  FieldRecord,
  HookRecord,
  IndexRecord,
  PluginRecord,
  SearchIndexRecord,
  ServiceField,
  VirtualRecord,
} from "./schema/metadata/metadata-types.ts";
