/*
 * The expression contract of aggregation for the rest of the core: the query layer's `Filter<T>.$expr` is
 * `ExprFor<Doc>`, and its runtime serializes filters with `ExprCompiler.resolveFilter`. Only this file is the
 * contract; everything else in `aggregate/` may change without notice to other layers.
 */

export { type UpdatePipelineFor, UpdatePipelines } from "../pipeline/update-pipelines.ts";
export type { PipelineDoc, StoredValue } from "../types/doc-shape.ts";
export { type BooleanExpr, ExprCompiler, type ExprFor, type ExprOver } from "./expr-compiler.ts";
export type { AnyExprNode, ExprCapabilities, ExprKind, ExprNode, NodeKind, NodeValue } from "./expr-node.ts";
export type { Arg, BareValue, Nullable } from "./expr-types.ts";
export type { FieldProxy } from "./field-proxy.ts";
