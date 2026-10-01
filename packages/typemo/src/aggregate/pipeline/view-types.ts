import type { PathError } from "../../types/paths.ts";
import type { Simplify } from "../expressions/expr-types.ts";
import type { PipelineDoc } from "../types/doc-shape.ts";
import type { PipelineBuilder } from "./pipeline-builder.ts";
import type { DocOf, EntityOf, SourceInput } from "./pipeline-source.ts";

/*
 * Row checks of pipelines that STORE their rows: a view (`ViewRowCheck`) and a materialized result (`$out`/`$merge`
 * into an entity). The view collection itself is created by the collection layer; here only the type-level
 * contract.
 */

/**
 * What a row must look like for the class `V`: its stored fields; `_id` is optional when the class
 * declares none (the server adds one to a written row), otherwise required.
 *
 * @typeParam V - The target class.
 * @example
 * ```ts
 * type A = RowTarget<{ _id: ObjectId; name: string }>; // { _id: ObjectId; name: string }
 * type B = RowTarget<{ name: string }>; // { name: string; _id?: unknown }
 * ```
 */
export type RowTarget<V> = "_id" extends keyof PipelineDoc<V>
  ? PipelineDoc<V>
  : Simplify<PipelineDoc<V> & { _id?: unknown }>;

/**
 * The keys of the class that the row does not provide with a compatible type.
 *
 * @typeParam Row - The row type.
 * @typeParam Target - The target document type.
 * @example
 * ```ts
 * type K = MismatchedKeys<{ a: string }, { a: number; b: string }>; // "a" | "b"
 * ```
 */
type MismatchedKeys<Row, Target> = {
  [K in keyof Target]-?: K extends keyof Row
    ? [Row[K]] extends [Target[K]]
      ? never
      : K
    : undefined extends Target[K]
      ? never
      : K;
}[keyof Target];

/**
 * `unknown` when `Row` fits the class `V`; otherwise an object type whose property names the problem
 * (the compiler prints it): a view pipeline cannot end with `$out`/`$merge` (row `never`), and every
 * field of the class must be provided with a compatible type.
 *
 * @typeParam Row - The row type of the pipeline.
 * @typeParam V - The view class.
 * @example
 * ```ts
 * type Ok = ViewRowCheck<{ name: string }, { name: string }>; // unknown
 * type Bad = ViewRowCheck<{ name: number }, { name: string }>; // an object type naming the mismatched keys
 * ```
 */
export type ViewRowCheck<Row, V> = [Row] extends [never]
  ? { readonly "a view pipeline cannot end with $out or $merge (MongoDB does not allow them in a view)": never }
  : [Row] extends [RowTarget<V>]
    ? unknown
    : {
        readonly "the pipeline result does not match the fields of the view class, check these fields": MismatchedKeys<
          Row,
          RowTarget<V>
        >;
      };

/**
 * The problems of a view pipeline whose rows are `Row` for the class `V` (a union of messages, `never` when it
 * fits): it cannot end with `$out`/`$merge`, and every field of the class must be provided with a compatible type
 * (one message per missing or mismatched field, e.g. `_id` after `project({ _id: 0 })` when the class has one).
 *
 * @typeParam Row - The row type of the pipeline.
 * @typeParam V - The view class.
 * @example
 * ```ts
 * type Ok = ViewRowProblems<{ name: string }, { name: string }>; // never
 * type Bad = ViewRowProblems<{ name: string }, { name: string; _id: ObjectId }>; // a message naming "_id"
 * ```
 */
export type ViewRowProblems<Row, V> = [Row] extends [never]
  ? "a view pipeline cannot end with $out or $merge (MongoDB does not allow them in a view)"
  : [Row] extends [RowTarget<V>]
    ? never
    : `the pipeline result does not match the fields of the view class: check the field "${MismatchedKeys<Row, RowTarget<V>> & string}"`;

/**
 * What the pipeline callback of `Pipeline.view` may return: the pipeline itself when its rows fit the view class,
 * otherwise `PathError` ALONE with the message (the error then reads "Type 'PipelineBuilder<…>' is not assignable to
 * type 'PathError<"the pipeline result does not match the fields of the view class: check the field \"_id\"">'", not a
 * long intersection of the pipeline type with an object whose property name is the message).
 *
 * @typeParam R - The staged pipeline the callback returned.
 * @typeParam V - The view class.
 * @example
 * ```ts
 * type Ok = ViewPipelineCheck<PipelineBuilder<{ name: string }, "view", "staged">, { name: string }>; // unchanged
 * ```
 */
export type ViewPipelineCheck<R, V> = [ViewRowProblems<ViewRowsOf<R>, V>] extends [never]
  ? R
  : /* the mapped type is written in place: an alias would be printed by its name, not by the messages */
    PathError<{ [K in ViewRowProblems<ViewRowsOf<R>, V> & string]: K }[ViewRowProblems<ViewRowsOf<R>, V> & string]>;

/**
 * The row type of a staged view pipeline (`never` for anything else, a terminal `$out` pipeline included).
 *
 * @typeParam R - The pipeline type.
 * @example
 * ```ts
 * type A = ViewRowsOf<PipelineBuilder<{ name: string }, "view", "staged">>; // { name: string }
 * ```
 */
type ViewRowsOf<R> = R extends PipelineBuilder<infer Row, "view", "staged"> ? Row : never;

/**
 * `unknown` when `Row` fits the target model `V` of an `$out`/`$merge`; otherwise `PathError` with a message that
 * names the field to check (the compiler then prints `PathError<"the pipeline rows do not match the target model: …">`,
 * not an object type whose property name is the message).
 *
 * @typeParam Row - The row type of the pipeline.
 * @typeParam V - The target model's document type.
 * @example
 * ```ts
 * type Ok = TargetRowCheck<{ name: string }, { name: string }>; // unknown
 * type Bad = TargetRowCheck<{ name: number }, { name: string }>; // PathError<"the pipeline rows do not match the target model: check the field \"name\"">
 * ```
 */
export type TargetRowCheck<Row, V> = [Row] extends [never]
  ? unknown
  : [Row] extends [RowTarget<V>]
    ? unknown
    : PathError<`the pipeline rows do not match the target model: check the field "${MismatchedKeys<Row, RowTarget<V>> & string}"`>;

/**
 * `$out`/`$merge` into an entity: the same check against the target class. A model source
 * is checked against its stored document.
 *
 * @typeParam Row - The row type of the pipeline.
 * @typeParam Src - The entity class or typed source the rows are written to.
 * @example
 * ```ts
 * type Ok = RowFits<{ name: string }, typeof User>; // unknown
 * ```
 */
export type RowFits<Row, Src extends SourceInput> = [EntityOf<Src>] extends [never]
  ? [Row] extends [DocOf<Src>]
    ? unknown
    : PathError<"the pipeline rows do not match the target collection's documents">
  : TargetRowCheck<Row, EntityOf<Src>>;
