/*
 * A filter or update typed AHEAD (`const f: Filter<User>`, a function parameter, a generic helper) passed to
 * `find`/`updateOne`/`$match` once hit TS2589 ("excessively deep"): the compiler measured the variance of the
 * `Filter`/`Update` aliases, and `Filter<T>` vs `Filter<T, true>` (distinct instantiations: the written arguments
 * differ) went through that measurement too. `Filter`, `Update`, `FieldConditions` and `RootOperators` now
 * declare their variance (`in out`). Every pattern below must compile without TS2589 and keep the result types.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { ObjectId } from "mongodb";
import type { Filter, Model, Update, UpdateResult } from "../../../src/index.ts";
import type { Order, Person } from "../../fixtures/model/model-entities.ts";

declare const People: Model<Person>;
declare const Orders: Model<Order>;

// ---- a variable ---------------------------------------------------------------------------------
const byName: Filter<Person> = { name: "a", age: { $gte: 1 } };
const rename: Update<Person> = { $set: { name: "b" }, $inc: { age: 1 } };

const leanAll = People.find().lean();
const leanOne = People.findOne().lean();
const many = People.find(byName).lean();
expectTypeOf<Awaited<typeof many>>().toEqualTypeOf<Awaited<typeof leanAll>>();
const one = People.findOne(byName).lean();
expectTypeOf<Awaited<typeof one>>().toEqualTypeOf<Awaited<typeof leanOne>>();
expectTypeOf(People.countDocuments(byName)).resolves.toEqualTypeOf<number>();
expectTypeOf(People.updateOne(byName, rename)).resolves.toEqualTypeOf<UpdateResult<ObjectId>>();
expectTypeOf(People.updateMany(byName, rename)).resolves.toEqualTypeOf<UpdateResult<ObjectId>>();
People.findOneAndUpdate(byName, rename);
People.deleteMany(byName);
People.exists(byName);
People.distinct("name", byName);
People.aggregate((p) => p.match(byName));
People.aggregate((p) => p.match(byName).sort({ name: 1 }).match(byName));

// the explicit `Loose` argument is the same filter
const explicit: Filter<Person, true> = byName;
const explicitUpdate: Update<Person, true> = rename;
People.updateOne(explicit, explicitUpdate);

// ---- a function parameter -------------------------------------------------------------------------
export const service = (filter: Filter<Person>, update: Update<Person>) => {
  People.updateOne(filter, update);
  People.find(filter).sort({ name: 1 });
  return People.aggregate((p) => p.match(filter).limit(1));
};
service(byName, rename);

// ---- a generic helper -----------------------------------------------------------------------------
export const updateAll = <T extends object>(model: Model<T>, filter: Filter<T>, update: Update<T>) =>
  model.updateMany(filter, update);
export const findAll = <T extends object>(model: Model<T>, filter: Filter<T>) => model.find(filter).lean();
expectTypeOf(updateAll(People, byName, rename)).resolves.toEqualTypeOf<UpdateResult<ObjectId>>();
const found = findAll(People, byName);
expectTypeOf<Awaited<typeof found>>().toEqualTypeOf<Awaited<typeof leanAll>>();
updateAll(Orders, { total: { $gt: 1 } }, { $set: { total: 2 } });

// ---- still checked --------------------------------------------------------------------------------
declare const orderFilter: Filter<Order>;
// @ts-expect-error a filter of ANOTHER entity is not a filter of Person
People.find(orderFilter);
// @ts-expect-error a filter of another entity does not fit a pipeline over Person's rows
People.aggregate((p) => p.match(orderFilter));
// @ts-expect-error after $project the rows no longer have the entity's shape: type the filter by the row
People.aggregate((p) => p.project({ name: 1 }).match(byName));
// @ts-expect-error a generic helper still ties the filter to the model
updateAll(People, orderFilter, rename);
// @ts-expect-error a declared filter still refuses unknown fields
const typo: Filter<Person> = { nmae: "x" };
void typo;
