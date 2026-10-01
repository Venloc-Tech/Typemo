/*
 * `untrusted(value, place?)`: the optional place is "filter", "update" or "projection" and only chooses the words
 * of the error; the value keeps its type in every place. Every `@ts-expect-error` says what must fail.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import { Filters, ModelOperations, type PlanExecutor, type UntrustedPlace, untrusted } from "../../../src/internal.ts";
import { Account } from "../../fixtures/steps/step-entities.ts";

declare const executor: PlanExecutor;
const Accounts = new ModelOperations(Account, executor);

expectTypeOf<UntrustedPlace>().toEqualTypeOf<"filter" | "update" | "projection">();
expectTypeOf(untrusted({ a: 1 })).toEqualTypeOf<{ readonly a: 1 }>();
expectTypeOf(untrusted({ a: 1 }, "filter")).toEqualTypeOf<{ readonly a: 1 }>();
expectTypeOf(untrusted({ a: 1 }, "update")).toEqualTypeOf<{ readonly a: 1 }>();
expectTypeOf(untrusted({ a: 1 }, "projection")).toEqualTypeOf<{ readonly a: 1 }>();

Accounts.find({ name: untrusted("x", "filter") });
Accounts.updateOne(Filters.all(), { $set: { name: untrusted("x", "update") } });

// @ts-expect-error the place is "filter", "update" or "projection": "sort" is none of them
untrusted({ a: 1 }, "sort");
// @ts-expect-error untrusted takes the value and at most one place
untrusted({ a: 1 }, "filter", "update");
