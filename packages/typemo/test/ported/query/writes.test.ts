/*
 * Ported from mongoose test/model.findOneAndUpdate.test.js, test/helpers/update.castArrayFilters.test.js,
 * test/query.test.js (update/where/hint parts) onto Typemo. Casting of values
 * (strings → numbers) belongs to the execution pipeline: only the plan/type logic is ported here.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import { ObjectId } from "mongodb";
import {
  BsonOptions,
  type Defaulted,
  Filters,
  type FindPlan,
  ModelOperations,
  type ModifyPlan,
  Prop,
  QueryError,
  Schema,
  type WritePlan,
} from "../../../src/internal.ts";
import { Entity } from "../../../src/schema/entity/base-classes.ts";
import { PlanRunner } from "../../fixtures/query/plan-runner.ts";

const mongo = MongoLifecycle.useMongo("ported_writes", BsonOptions.apply({}));
const runner = new PlanRunner(() => mongo.db);

@Schema()
class Individual {
  @Prop(() => String)
  userId?: string;

  @Prop(() => Number)
  all?: number;
}

@Schema()
class AllUsers {
  @Prop(() => Number)
  all?: number;
}

@Schema()
class ItemsInfo {
  @Prop(() => AllUsers)
  allUsers?: AllUsers;

  @Prop(() => [Individual])
  individual!: Individual[];
}

@Schema()
class Suggested {
  @Prop(() => String)
  key?: string;

  @Prop(() => Boolean)
  isDeleted?: boolean;
}

@Schema()
class AppointmentQuery {
  @Prop(() => [Suggested])
  suggestedAppointment!: Suggested[];
}

@Schema()
class Appointment {
  @Prop(() => [AppointmentQuery])
  queries!: AppointmentQuery[];
}

@Schema()
class Nested {
  @Prop(() => Number)
  nestedId?: number;

  @Prop(() => Boolean)
  code?: boolean;
}

@Schema()
class Outer {
  @Prop(() => Number)
  id?: number;

  @Prop(() => [Nested])
  nestedArr!: Nested[];
}

@Schema()
class Prop2 {
  @Prop(() => String)
  name?: string;
}

@Schema({ collection: "ported_things" })
class Thing extends Entity {
  @Prop(() => String)
  title?: string;

  @Prop(() => Boolean, { default: false })
  flag!: Defaulted<boolean>;

  @Prop(() => ItemsInfo)
  itemsInfo?: ItemsInfo;

  @Prop(() => Appointment)
  doctorsAppointment?: Appointment;

  @Prop(() => [Outer])
  arr!: Outer[];

  @Prop(() => [Prop2])
  props!: Prop2[];

  @Prop(() => [String])
  names!: string[];
}

const Things = new ModelOperations(Thing, runner);

beforeEach(async () => {
  await mongo.db.collection("ported_things").insertOne({
    title: "Tobi",
    flag: false,
    itemsInfo: {
      allUsers: { all: 0 },
      individual: [
        { userId: "1", all: 0 },
        { userId: "9", all: 0 },
      ],
    },
    doctorsAppointment: { queries: [{ suggestedAppointment: [{ key: "123", isDeleted: false }] }] },
    arr: [{ id: 1, nestedArr: [{ nestedId: 2, code: false }] }],
    props: [{ name: "invalid" }, { name: "abc" }, { name: "def" }],
    names: ["Test"],
  });
});

describe("findOneAndUpdate", () => {
  // ported from mongoose test/model.findOneAndUpdate.test.js:88 "returns the edited document"
  test("returns the edited document — divergence: it is the DEFAULT, Mongoose needs new: true", async () => {
    const doc = await Things.findOneAndUpdate({ title: "Tobi" }, { $set: { title: "Woot" } })
      .orFail()
      .lean();
    expect(doc.title).toBe("Woot");
  });

  // ported from mongoose test/model.findOneAndUpdate.test.js:279 "returns the original document"
  test("returns the original document", async () => {
    const doc = await Things.findOneAndUpdate(
      { title: "Tobi" },
      { $set: { title: "Woot" } },
      { returnDocument: "before" },
    )
      .orFail()
      .lean();
    expect(doc.title).toBe("Tobi");
  });

  // ported from mongoose test/model.findOneAndUpdate.test.js:688 "returns null when doing an upsert & new=false gh-1533"
  test("returns null when doing an upsert & new=false gh-1533 (returnDocument: 'before', H059)", async () => {
    const first = await Things.findOneAndUpdate(
      { title: "key" },
      { $set: { flag: false } },
      { upsert: true, returnDocument: "before" },
    ).lean();
    expect(first).toBeNull();
    const second = await Things.findOneAndUpdate(
      { title: "key" },
      { $set: { flag: false } },
      { upsert: true, returnDocument: "before" },
    ).lean();
    expect([second?.title, second?.flag]).toEqual(["key", false]);
  });

  // ported from mongoose test/model.findOneAndUpdate.test.js:726 "return includeResultMetadata when doing an upsert & new=false gh-7770"
  test("return includeResultMetadata when doing an upsert & new=false gh-7770", async () => {
    const first = await Things.findOneAndUpdate(
      { title: "new" },
      { $set: { flag: false } },
      { upsert: true, returnDocument: "before" },
    )
      .lean()
      .includeResultMetadata();
    expect(first.lastErrorObject?.updatedExisting).toBe(false);
    expect(first.lastErrorObject?.upserted).toBeInstanceOf(ObjectId);
    const second = await Things.findOneAndUpdate(
      { title: "new" },
      { $set: { flag: true } },
      { upsert: true, returnDocument: "before" },
    )
      .lean()
      .includeResultMetadata();
    expect([second.lastErrorObject?.updatedExisting, second.value?.flag]).toEqual([true, false]);
  });

  // ported from mongoose test/model.findOneAndUpdate.test.js:748 "allows properties to be set to null gh-1643"
  test("allows properties to be set to null gh-1643 — divergence: null only on nullable fields", () => {
    // @ts-expect-error `names` is not nullable
    const build = () => Things.findOneAndUpdate({}, { $set: { names: null } });
    expect(build).not.toThrow(); // the value check is the schema's (a cast at execution), the type refuses it already
  });

  // ported from mongoose test/model.findOneAndUpdate.test.js:871 "accepts undefined"
  test("accepts undefined — divergence: undefined is an error", () => {
    // @ts-expect-error undefined is never a value
    expect(() => Things.findOneAndUpdate({}, { $set: { title: undefined } }, {})).toThrow(QueryError);
  });

  // ported from mongoose test/model.findOneAndUpdate.test.js:160 "preserves own __proto__ keys in update payloads without mutating the caller update (gh-16202)"
  test("preserves own __proto__ keys in update payloads without mutating the caller update (gh-16202) — plan level", () => {
    const inner = JSON.parse('{"__proto__": "abcd"}') as Record<string, unknown>;
    const update = { $set: { itemsInfo: inner } };
    const plan = Things.findOneAndUpdate(Filters.all(), update as never).build() as ModifyPlan;
    const planned = (plan.update as { $set: { itemsInfo: object } }).$set.itemsInfo;
    expect(Object.hasOwn(planned, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(planned)).toBe(Object.prototype);
    expect(Object.hasOwn(update.$set.itemsInfo, "__proto__")).toBe(true);
  });

  // ported from mongoose test/model.findOneAndUpdate.test.js:180 "does not mutate the caller update when chaining set() after findOneAndUpdate()"
  test("does not mutate the caller update (the builder never changes its input)", () => {
    const update = { $set: { title: "after" } };
    Things.findOneAndUpdate(Filters.all(), update).select({ title: 1 }).build();
    expect(update).toEqual({ $set: { title: "after" } });
  });
});

describe("arrayFilters (castArrayFilters)", () => {
  // ported from mongoose test/helpers/update.castArrayFilters.test.js:64 "sane error on same filter twice"
  test("sane error on same filter twice", () => {
    expect(() =>
      Things.updateOne(
        Filters.all(),
        { $set: { "arr.$[x].nestedArr.$[x].code": true } },
        { arrayFilters: [{ "x.id": 1 }] },
      ),
    ).toThrow(/uses the array filter "x" twice/);
  });

  // ported from mongoose test/helpers/update.castArrayFilters.test.js:83 "using $in (gh-7431)"
  test("using $in (gh-7431)", async () => {
    const plan = Things.updateOne(
      Filters.all(),
      { $inc: { "itemsInfo.allUsers.all": 1, "itemsInfo.individual.$[element].all": 1 } },
      { arrayFilters: [{ "element.userId": { $in: ["1", "2", "3"] } }] },
    );
    expect((plan.build() as WritePlan).arrayFilters).toEqual([{ "element.userId": { $in: ["1", "2", "3"] } }]);
    await plan;
    const stored = await mongo.db.collection("ported_things").findOne({});
    expect(stored?.itemsInfo.individual.map((entry: { all: number }) => entry.all)).toEqual([1, 0]);
  });

  // ported from mongoose test/helpers/update.castArrayFilters.test.js:108 "all positional operator works (gh-7540)"
  test("all positional operator works (gh-7540)", async () => {
    await Things.updateOne(
      Filters.all(),
      { $set: { "doctorsAppointment.queries.$[].suggestedAppointment.$[u].isDeleted": true } },
      { arrayFilters: [{ "u.key": "123" }] },
    );
    const stored = await mongo.db.collection("ported_things").findOne({});
    expect(stored?.doctorsAppointment.queries[0].suggestedAppointment[0].isDeleted).toBe(true);
  });

  // ported from mongoose test/helpers/update.castArrayFilters.test.js:128 "handles deeply nested arrays (gh-7603)"
  test("handles deeply nested arrays (gh-7603)", async () => {
    await Things.updateOne(
      Filters.all(),
      { $set: { "arr.$[arr].nestedArr.$[nArr].code": true } },
      { arrayFilters: [{ "arr.nestedArr.nestedId": 2 }, { "nArr.nestedId": 2 }] },
    );
    const stored = await mongo.db.collection("ported_things").findOne({});
    expect(stored?.arr[0].nestedArr[0].code).toBe(true);
  });
});

describe("query builder (test/query.test.js)", () => {
  // ported from mongoose test/query.test.js:525 "size via where" (and :531 not via where)
  test("size via where", () => {
    expect(Things.find().where("names").size(5).build().filter).toEqual({ names: { $size: 5 } });
    expect(Things.find({ names: { $size: 5 } }).build().filter).toEqual({ names: { $size: 5 } });
  });

  // ported from mongoose test/query.test.js:672 "limit works" and :679 "with string limit (gh-11017)"
  test("limit works; a string limit is refused — divergence: no casting of query settings", () => {
    expect((Things.find().limit(5).build() as FindPlan).limit).toBe(5);
    // @ts-expect-error a string limit
    expect(() => Things.find().limit("5")).toThrow(QueryError);
  });

  // ported from mongoose test/query.test.js:837 "doesn't wipe out $in (gh-6439)"
  test("doesn't wipe out $in (gh-6439)", async () => {
    await Things.updateOne(Filters.all(), { $pull: { props: { $in: [{ name: "invalid" }, { name: "def" }] } } });
    const stored = await mongo.db.collection("ported_things").findOne({});
    expect(stored?.props).toEqual([{ name: "abc" }]);
  });

  // ported from mongoose test/query.test.js:1133 "optionsForExec should retain key order"
  test("should retain key order (hint)", () => {
    const hint = { title: 1, flag: 1, names: 1 } as const;
    const plan = Things.find().hint(hint).build();
    expect(JSON.stringify(plan.options.hint)).toBe(JSON.stringify(hint));
  });
});
