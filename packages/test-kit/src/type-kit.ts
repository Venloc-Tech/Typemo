/*
 * Public API of the type, hover and shape tooling of `@venloc/typemo-test-kit`.
 * The package barrel (`index.ts`) re-exports this file.
 */

export { expectTypeOf } from "expect-type";
export {
  type AnyAllowEntry,
  type AnyFinding,
  NoAnyInPublicApi,
  type NoAnyOptions,
  type NoAnyReport,
} from "./guards/no-any-in-public-api.ts";
export {
  expectHover,
  expectNoTypeErrors,
  expectTypeError,
  HoverExpectation,
  type HoverExpectOptions,
  TypeErrorExpectation,
  type TypeErrorExpectOptions,
} from "./hover/hover-expect.ts";
export { type HoverMarker, HoverText } from "./hover/hover-text.ts";
export {
  PROBE_TYPE_FORMAT,
  type ProbeCheckOptions,
  ProbeSource,
  type ProbeTypeQuery,
  TypeProbe,
  type TypeProbeOptions,
} from "./hover/type-probe.ts";
export { RuntimeShape } from "./shape/runtime-shape.ts";
export type { FieldShape, ScalarKind, Shape } from "./shape/shape.ts";
export { ShapeFormat } from "./shape/shape.ts";
export {
  expectShapeMatches,
  type ShapeCheckResult,
  ShapeCompare,
  type ShapeCompareOptions,
  type ShapeMismatch,
  type ShapeTarget,
} from "./shape/shape-harness.ts";
export { TypeShape } from "./shape/type-shape.ts";
export { DeclarationBuild, type DeclarationBuildResult } from "./types/declaration-build.ts";
export { type LoadedTsConfig, TsConfig } from "./types/ts-config.ts";
export type * from "./types/type-assertions.ts";
export {
  type TypeCheckOptions,
  type TypeCheckResult,
  TypeCheckRunner,
  type TypeDiagnostic,
} from "./types/type-check-runner.ts";
