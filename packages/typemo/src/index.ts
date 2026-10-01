/** The package version reported at runtime. */
export const VERSION = "0.0.0";

/* --- aggregation pipeline and expressions --- */
export type {
  BooleanExpr,
  ExprFor,
  ExprOver,
} from "./aggregate/expressions/expr-compiler.ts";
export type {
  AnyExprNode,
  ExprCapabilities,
  ExprKind,
  ExprNode,
  NodeKind,
  NodeValue,
  SomeExprNode,
} from "./aggregate/expressions/expr-node.ts";
export type { Arg, ArgValue, BareValue, Nullable, PropagateNull } from "./aggregate/expressions/expr-types.ts";
export type { FieldPath, FieldProxy, VarProxy } from "./aggregate/expressions/field-proxy.ts";
export { type Fn, fn } from "./aggregate/expressions/fn.ts";
export type { Numeric, NumericResult } from "./aggregate/expressions/ops/arithmetic-ops.ts";
export type {
  ConvertFormat,
  ConvertResult,
  ConvertTarget,
  HashAlgorithm,
  TypeName,
} from "./aggregate/expressions/ops/conversion-ops.ts";
export type { DateParts, DateUnit, IsoDateParts, StartOfWeek } from "./aggregate/expressions/ops/date-ops.ts";
export type { MetaValues, SimilarityVector } from "./aggregate/expressions/ops/misc-ops.ts";
export type { RegexMatch } from "./aggregate/expressions/ops/string-ops.ts";
export { type WindowBound, type WindowSpec, withWindow } from "./aggregate/expressions/ops/window-ops.ts";
export type {
  SortDirectionInput,
  SortKey,
  SortKeys,
  SortOrder,
  SortSpecOf,
  SortWord,
} from "./aggregate/expressions/sort-spec.ts";
export { type RedactVerdict, type UserRole, Vars } from "./aggregate/expressions/vars.ts";
export type {
  AggregateOptions,
  AggregatePlan,
  IndexHint,
  IndexKeyValue,
  PipelineStage,
  PlanRow,
} from "./aggregate/pipeline/aggregate-plan.ts";
export { Pipeline, type ViewDefinition } from "./aggregate/pipeline/pipeline.ts";
export type {
  BucketGranularity,
  FacetHostMode,
  FilterMode,
  GeneralMode,
  MatchFilter,
  MergeVars,
  MetaSort,
  PipelineBuilder,
  PipelineMode,
  PipelineState,
  RowOf,
  SealedPipeline,
  SortCheck,
  SortStageSpec,
  StagedPipeline,
  TerminalPipeline,
  TopMode,
  UnwindSpec,
  VarsOf,
} from "./aggregate/pipeline/pipeline-builder.ts";
export type {
  DocOf,
  HiddenOf,
  PipelineSource,
  PipelineTarget,
  SourceInput,
  StoredDocOf,
} from "./aggregate/pipeline/pipeline-source.ts";
export type * from "./aggregate/pipeline/stage-specs.ts";
export { type UpdatePipelineFor, UpdatePipelines } from "./aggregate/pipeline/update-pipelines.ts";
export type {
  RowFits,
  RowTarget,
  TargetRowCheck,
  ViewPipelineCheck,
  ViewRowCheck,
} from "./aggregate/pipeline/view-types.ts";
export type { PipelineDoc, StoredValue, VisibleDoc } from "./aggregate/types/doc-shape.ts";
export { BsonGuards, type BsonTypeTag } from "./bson/bson-guards.ts";
export { BsonOptions, type CompatibleBsonOptions, type RequiredBsonOptions } from "./bson/bson-options.ts";
export {
  type BsonContainerKey,
  type BsonForms,
  type BsonScalarForms,
  type BsonScalarKey,
  type BsonScalarRow,
  type BsonTypeAlias,
  type BsonTypeKey,
  type BsonTypeRow,
  BsonTypeTable,
  type IsVector,
  type JsonValue,
  type LeanValue,
  type MaxKeyJson,
  type MinKeyJson,
  type PlainValue,
  type TimestampJson,
  type Vector,
  type VectorMarker,
} from "./bson/bson-type-table.ts";
export type { VectorDtype } from "./bson/casters/vector-caster.ts";
export type { IsPlainObject, OpaqueValue } from "./bson/opaque-value.ts";
export * as Types from "./bson/types.ts";
export * from "./change-streams/public.ts";
export * from "./collections/public.ts";
export * from "./connection/public.ts";
export * from "./cursor/public.ts";
export * from "./document/collections/public.ts";
export * from "./document/public.ts";
export * from "./errors/public.ts";
export * from "./hooks/public.ts";
export * from "./instrumentation/public.ts";
export * from "./model/public.ts";
export * from "./operation/public.ts";
export * from "./pagination/public.ts";
export * from "./plugins/public.ts";
export * from "./policies/public.ts";
export { isPopulated } from "./populate/is-populated.ts";
export { isPresent } from "./populate/is-present.ts";
/* --- query types and builders (the list lives in src/query/public.ts) --- */
export * from "./query/public.ts";
/* Integrations read a schema through the read-only `SchemaInfo` (`OperationInfo.schema`); `CompiledSchema`, the
   compiler, the walker, the metadata store and the path nodes are internal (`src/internal.ts`). */
export type {
  CompiledIndex,
  DiscriminatorInfo,
  HookTable,
  PathDescription,
  SchemaDescription,
  SchemaInfo,
  VirtualDefinition,
} from "./schema/compiler/compiled-schema.ts";
export type { PathKind, ScalarType } from "./schema/compiler/path-node.ts";
export type { SchemaSource } from "./schema/compiler/schema-source.ts";
export { type HookMethod, Post, PostError, Pre } from "./schema/decorators/hooks.ts";
export { Index, SearchIndex } from "./schema/decorators/index-decorators.ts";
export { Prop, type PropDecorator } from "./schema/decorators/prop.ts";
export type { PropCheck } from "./schema/decorators/prop-check.ts";
export { Discriminator, Plugin, Schema } from "./schema/decorators/schema.ts";
export { Tenant } from "./schema/decorators/tenant.ts";
export { Virtual } from "./schema/decorators/virtual.ts";
export {
  Entity,
  type EntityIdOptions,
  EntityWithId,
  type EntityWithIdFactory,
  type IdBase,
  type IdSpec,
  type Mixed,
  Timestamped,
  type TimestampFields,
  Versioned,
  type VersionFields,
} from "./schema/entity/base-classes.ts";
export type {
  ExtensionFieldInfo,
  ExtensionName,
  ExtensionSchemaInfo,
  PropExtensions,
  SchemaExtensions,
  TypemoExtension,
} from "./schema/extensions/extension-registry.ts";
export {
  type BsonJsonSchema,
  type CollectionValidator,
  JsonSchemaGenerator,
} from "./schema/json-schema/json-schema-generator.ts";
export type { ClassRef, HookFunction, PluginBuilder, SchemaPlugin } from "./schema/metadata/metadata-types.ts";
export { CollectionNaming } from "./schema/naming/collection-naming.ts";
export type {
  IndexDirection,
  IndexFields,
  IndexOptions,
  PartialFilter,
  PartialFilterCondition,
  SearchIndexOptions,
} from "./schema/options/index-options.ts";
export type {
  BigIntPropOptions,
  CommonPropOptions,
  DatePropOptions,
  DefaultOption,
  FieldIndexKind,
  FieldValidator,
  NumberPropOptions,
  PropOptions,
  RefOptions,
  SensitiveJson,
  SensitiveOption,
  StringPropOptions,
  SubdocumentPropOptions,
} from "./schema/options/prop-options.ts";
export type {
  AuditSchemaOptions,
  CappedSchemaOptions,
  SchemaOptions,
  SoftDeleteSchemaOptions,
  TenantSchemaOptions,
  TimeSeriesSchemaOptions,
  ValidatorSchemaOptions,
} from "./schema/options/schema-options.ts";
export {
  type BinarySpec,
  type EntityClass,
  type MapSpec,
  type MapSpecBuilder,
  type MapSpecOptions,
  type ScalarSpec,
  Spec,
  type SpecValue,
  type TypeSpec,
  type UnionSpec,
  type VectorSpec,
} from "./schema/options/type-spec.ts";
export type { VirtualOptions, VirtualQueryOptions } from "./schema/options/virtual-options.ts";
export {
  type AnyStandardSchema,
  StandardSchema,
  type StandardSchemaInput,
  type StandardSchemaIssue,
  type StandardSchemaOutput,
  type StandardSchemaProps,
  type StandardSchemaResult,
  type StandardSchemaV1,
} from "./schema/standard-schema/standard-schema.ts";
export { Typemo } from "./typemo.ts";
/* --- schema --- */
export type {
  Computed,
  Defaulted,
  Discriminators,
  DiscriminatorsMarker,
  DiscriminatorValue,
  Hidden,
  Immutable,
  Ref,
  TenantField,
  Unbranded,
  VirtualRef,
  VirtualValue,
} from "./types/markers.ts";
export type { DataKeys, KeysOfType, SchemaPaths } from "./types/schema-paths.ts";
