/*
 * Types that users name in their own code are reachable from the package entry: the cursor and its source, the
 * write builder, the validator contexts and the error classifier. A for await over a query does not compile.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { UpdateResult } from "mongodb";
import {
  type CursorSource,
  type DocumentValidationContext,
  type ErrorClassification,
  ErrorClassifier,
  Filters,
  type QueryCursor,
  type UpdateValidationContext,
  type ValidationContext,
  type WriteBuilder,
} from "../../../src/index.ts";
import { Members } from "./setup.ts";

// ---- QueryCursor, CursorSource ----------------------------------------------------------------------
const cursor = Members.find().lean().cursor();
expectTypeOf(cursor).toExtend<QueryCursor<unknown>>();
expectTypeOf<QueryCursor<number>>().toExtend<AsyncIterable<number, void, undefined>>();
expectTypeOf<CursorSource<number>>().toExtend<AsyncIterable<number, void, undefined>>();

// ---- WriteBuilder ------------------------------------------------------------------------------------
const write = Members.updateOne(Filters.all(), { $set: { name: "a" } });
expectTypeOf(write).toExtend<WriteBuilder<UpdateResult>>();

// ---- validator contexts ------------------------------------------------------------------------------
expectTypeOf<DocumentValidationContext | UpdateValidationContext>().toEqualTypeOf<ValidationContext>();

// ---- ErrorClassifier.classify --------------------------------------------------------------------------
expectTypeOf(ErrorClassifier.classify(new Error("x"))).toEqualTypeOf<ErrorClassification>();
expectTypeOf(ErrorClassifier.isRetryable(new Error("x"))).toEqualTypeOf<boolean>();
// @ts-expect-error turning driver errors into Typemo errors is internal: the public classifier has no wrap
ErrorClassifier.wrap(new Error("x"));
// @ts-expect-error the raw driver error behind a Typemo error is internal: the public classifier has no driverCause
ErrorClassifier.driverCause(new Error("x"));

// ---- a query is not async-iterable ---------------------------------------------------------------------
export const iterate = async (): Promise<void> => {
  // @ts-expect-error a query is not async-iterable (TS2504): iterate .cursor() instead
  for await (const _ of Members.find()) {
    /* never reached */
  }
};
