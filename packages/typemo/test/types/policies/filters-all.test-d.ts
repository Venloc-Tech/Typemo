/*
 * `Filters.all()` without a type argument is a filter of every model: each operation that takes a filter
 * accepts it, including the ones that refuse an empty filter. `Filters.all<Model>()` keeps its typed form.
 * Every `@ts-expect-error` says what must fail.
 */
import type { AssertEqual, Expect } from "@venloc/typemo-test-kit";
import { type Filter, Filters, ModelOperations, type PlanExecutor } from "../../../src/internal.ts";
import { Account, Plain } from "../../fixtures/steps/step-entities.ts";

declare const executor: PlanExecutor;
const Accounts = new ModelOperations(Account, executor);
const Plains = new ModelOperations(Plain, executor);

/* Without a type argument: every operation of every model. */
Accounts.find(Filters.all());
Accounts.findOne(Filters.all());
Accounts.exists(Filters.all());
Accounts.countDocuments(Filters.all());
Accounts.distinct("name", Filters.all());
Accounts.updateOne(Filters.all(), { $set: { name: "x" } });
Accounts.updateMany(Filters.all(), { $set: { name: "x" } });
Accounts.deleteOne(Filters.all());
Accounts.deleteMany(Filters.all());
Accounts.findOneAndUpdate(Filters.all(), { $set: { name: "x" } });
Accounts.findOneAndDelete(Filters.all());
Plains.deleteMany(Filters.all());
Plains.updateMany(Filters.all(), { $set: { title: "x" } });
Plains.countDocuments(Filters.all());

/* The same value serves several models. */
const all = Filters.all();
Accounts.deleteMany(all);
Plains.deleteMany(all);

/* With a type argument: the typed filter of that model, as before. */
Accounts.deleteMany(Filters.all<Account>());
Accounts.updateMany(Filters.all<Account>(), { $set: { name: "x" } });
export type Typed = [Expect<AssertEqual<ReturnType<typeof Filters.all<Account>>, Filter<Account>>>];

/* It stays a filter value: it cannot be combined into a filter of the wrong shape. */
// @ts-expect-error — the untyped form is not a filter of a document without `_id`
export const noId: Filter<{ readonly title: string }> = Filters.all();

/* An empty object literal is refused by the writes that change or remove documents (one or many). */
// @ts-expect-error — an empty filter literal: use Filters.all() to mean "any document" on purpose
Accounts.updateOne({}, { $set: { name: "x" } });
// @ts-expect-error — an empty filter literal: use Filters.all() to mean "every document" on purpose
Accounts.updateMany({}, { $set: { name: "x" } });
// @ts-expect-error — an empty filter literal: use Filters.all() to mean "any document" on purpose
Accounts.deleteOne({});
// @ts-expect-error — an empty filter literal: use Filters.all() to mean "every document" on purpose
Accounts.deleteMany({});
// @ts-expect-error — an empty filter literal: use Filters.all() to mean "any document" on purpose
Accounts.replaceOne({}, { name: "x", email: "a@b.test" });
/* Reads keep accepting it; a non-empty literal and a declared filter type are fine (the run-time rule covers a declared one). */
Accounts.find({});
Accounts.countDocuments({});
Accounts.updateOne({ name: "a" }, { $set: { name: "x" } });
declare const declared: Filter<Account>;
Accounts.deleteMany(declared);
export const updateEvery = <T extends object>(model: ModelOperations<T>, filter: Filter<T>) => model.deleteMany(filter);
