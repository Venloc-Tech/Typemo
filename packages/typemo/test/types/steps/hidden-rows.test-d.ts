/*
 * The rows of an aggregation over an entity have no `Hidden` fields (the pipeline removes them with a leading
 * `$unset`, the `HiddenPolicy` step); `include` brings named ones back, like `+field` of `find`. The same for
 * documents joined from an entity (`$lookup`, `$unionWith`, `$graphLookup`). Update pipelines, `$merge` targets
 * and change streams see the STORED document (hidden fields included). Every `@ts-expect-error` says what must
 * fail.
 */
import type { AssertEqual, Expect } from "@venloc/typemo-test-kit";
import {
  Filters,
  fn,
  ModelOperations,
  Pipeline,
  type PlanExecutor,
  type RowOf,
  type StoredDocOf,
  type UpdateValidationContext,
  type ValidationContext,
  type VisibleDoc,
} from "../../../src/internal.ts";
import { Account, Plain } from "../../fixtures/steps/step-entities.ts";

type Keys<T> = keyof T & string;

const rows = Pipeline.from(Plain);
export type RowKeys = [Expect<AssertEqual<Keys<RowOf<typeof rows>>, "_id" | "title" | "n">>];

const included = Pipeline.from(Plain, { include: ["secret"] });
export type IncludedKeys = [
  Expect<AssertEqual<Keys<RowOf<typeof included>>, "_id" | "title" | "n" | "secret">>,
  Expect<AssertEqual<RowOf<typeof included>["secret"], string | undefined>>,
];

// @ts-expect-error — `title` is not a hidden path: only hidden paths can be included
Pipeline.from(Plain, { include: ["title"] });

// @ts-expect-error — a hidden field is not a field of the rows (match on it would silently match nothing)
Pipeline.from(Plain).match({ secret: "x" });

// @ts-expect-error — nor a path of `$project`
Pipeline.from(Account).project({ password: 1 });

Pipeline.from(Account, { include: ["password"] }).match({ password: "x" });

const joined = Pipeline.from(Account).lookup({ from: Plain, localField: "name", foreignField: "title", as: "plain" });
export type JoinedKeys = [Expect<AssertEqual<Keys<RowOf<typeof joined>["plain"][number]>, "_id" | "title" | "n">>];

// Stored forms keep the hidden fields.
export type Stored = [
  Expect<AssertEqual<"secret" extends Keys<StoredDocOf<typeof Plain>> ? true : false, true>>,
  Expect<AssertEqual<"secret" extends Keys<VisibleDoc<Plain>> ? true : false, false>>,
];
Pipeline.update(Account).set((f) => ({ password: fn.concat(f.password, "!") }));

// Validators receive a typed context.
declare const context: ValidationContext;
export const operator = context.kind === "update" ? context.operator : undefined;
export type Operators = [
  Expect<
    AssertEqual<UpdateValidationContext["operator"], "$set" | "$setOnInsert" | "$min" | "$max" | "$push" | "$addToSet">
  >,
];

// RequireFilter: `Filters.all()` is a filter of the model.
declare const executor: PlanExecutor;
const Accounts = new ModelOperations(Account, executor);
Accounts.deleteMany(Filters.all<Account>());
