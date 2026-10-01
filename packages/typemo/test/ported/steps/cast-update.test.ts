import { beforeEach, describe, expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import type { Document } from "mongodb";
import { StrictModeError } from "../../../src/errors/strict-mode-error.ts";
import {
  BsonOptions,
  CastError,
  type Defaulted,
  Entity,
  Filters,
  ModelOperations,
  Prop,
  Schema,
} from "../../../src/internal.ts";
import type { ExecutionPlan } from "../../../src/operation/pipeline/execution-plan.ts";
import { PlanCapture, RawExecute, StepHarness } from "../../fixtures/steps/step-harness.ts";

/*
 * Ported from Mongoose `castArrayFilters`, `applyTimestampsToUpdate`, update validators and
 * `setDefaultsOnInsert` tests. Logic kept; Typemo's strict casts make some inputs errors — marked.
 */

@Schema()
class Reply {
  @Prop(() => Date)
  date?: Date;

  @Prop(() => Date)
  beginAt?: Date;

  @Prop(() => Date)
  endAt?: Date;
}

@Schema()
class Comment {
  @Prop(() => String)
  text?: string;

  @Prop(() => [Reply])
  replies?: Reply[];
}

@Schema({ collection: "ported_comments" })
class Post extends Entity {
  @Prop(() => [Comment])
  comments?: Comment[];
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
  nestedArr?: Nested[];
}

@Schema({ collection: "ported_arrs" })
class Arrs extends Entity {
  @Prop(() => [Outer])
  arr?: Outer[];
}

@Schema()
class File {
  @Prop(() => String)
  name?: string;
}

@Schema({ collection: "ported_companies" })
class Company extends Entity {
  @Prop(() => String)
  name?: string;

  @Prop(() => File)
  file?: File;
}

@Schema()
class Product {
  @Prop(() => String)
  name?: string;
}

@Schema()
class Sell {
  @Prop(() => Product, { required: true })
  product!: Product;
}

@Schema({ collection: "ported_sellers" })
class Seller extends Entity {
  @Prop(() => [Sell])
  sell?: Sell[];
}

@Schema()
class Inner {
  @Prop(() => Number)
  num?: number;
}

@Schema({ collection: "ported_versioned" })
class Counter extends Entity {
  @Prop(() => Number)
  num?: number;

  @Prop(() => [Inner])
  arr?: Inner[];
}

@Schema({ collection: "ported_defaults" })
class WithDefault extends Entity {
  @Prop(() => String, { default: "test" })
  str!: Defaulted<string>;

  @Prop(() => Number)
  num?: number;
}

const mongo = MongoLifecycle.useMongo("ported_steps", BsonOptions.apply({}));
const capture = new PlanCapture();
// biome-ignore lint/suspicious/noExplicitAny: ported tests pass untyped updates like the originals.
const loose = (value: unknown): any => value;
type Loose = Record<string, unknown>;

const arrayFilters = async <T extends object>(model: ModelOperations<T>, update: Loose, filters: Loose[]) => {
  const ctx = await StepHarness.cast(
    await capture.plan(model.updateOne(loose(Filters.all()), loose(update), loose({ arrayFilters: filters }))),
  );
  return ctx.arrayFilters as Loose[];
};

beforeEach(async () => {
  await mongo.db.collection("ported_companies").deleteMany({});
});

describe("castArrayFilters (ported)", () => {
  const Posts = new ModelOperations(Post, capture);
  const Arrays = new ModelOperations(Arrs, capture);

  // ported from mongoose test/helpers/update.castArrayFilters.test.js:10 "works"
  test("works", async () => {
    const [filter] = await arrayFilters(Posts, { $set: { "comments.$[x].replies.$[].date": "2018-01-01" } }, [
      { "x.text": { $gte: "a" } },
    ]);
    expect(filter).toEqual({ "x.text": { $gte: "a" } });
    const [dated] = await arrayFilters(Posts, { $set: { "comments.$[].replies.$[x].date": "2018-01-01" } }, [
      { "x.date": { $gte: "2018-01-01" } },
    ]);
    expect(((dated as Loose)["x.date"] as Loose).$gte).toBeInstanceOf(Date);
  });

  // ported from mongoose test/helpers/update.castArrayFilters.test.js:23 "casts multiple"
  test("casts multiple (divergence: 123 on a string path is not turned into '123', L1)", async () => {
    const filters = await arrayFilters(Posts, { $set: { "comments.$[x].replies.$[y].date": "2018-01-01" } }, [
      { "x.text": "123" },
      { "y.date": { $gte: "2018-01-01" } },
    ]);
    expect((filters[0] as Loose)["x.text"]).toBe("123");
    expect(((filters[1] as Loose)["y.date"] as Loose).$gte).toBeInstanceOf(Date);
    await expect(
      arrayFilters(Posts, { $set: { "comments.$[x].replies.$[y].date": "2018-01-01" } }, [
        { "x.text": 123 },
        { "y.date": { $gte: "2018-01-01" } },
      ]),
    ).rejects.toBeInstanceOf(CastError);
  });

  // ported from mongoose test/helpers/update.castArrayFilters.test.js:41 "casts on multiple fields"
  test("casts on multiple fields", async () => {
    const filters = await arrayFilters(Posts, { $set: { "comments.$[x].replies.$[y].endAt": "2019-01-01" } }, [
      { "x.text": "123" },
      { "y.beginAt": { $gte: "2018-01-01" }, "y.endAt": { $lt: "2020-01-01" } },
    ]);
    expect(((filters[1] as Loose)["y.beginAt"] as Loose).$gte).toBeInstanceOf(Date);
    expect(((filters[1] as Loose)["y.endAt"] as Loose).$lt).toBeInstanceOf(Date);
  });

  // ported from mongoose test/helpers/update.castArrayFilters.test.js:64 "sane error on same filter twice"
  test("sane error on same filter twice", () => {
    expect(() =>
      Posts.updateOne(
        Filters.all(),
        loose({ $set: { "comments.$[x].replies.$[x].date": "2018-01-01" } }),
        loose({ arrayFilters: [{ "x.text": "a" }] }),
      ),
    ).toThrow(/twice/);
  });

  // ported from mongoose test/helpers/update.castArrayFilters.test.js:108 "all positional operator works (gh-7540)"
  test("all positional operator works (gh-7540)", async () => {
    const [filter] = await arrayFilters(Posts, { $set: { "comments.$[].replies.$[u].date": "2018-01-01" } }, [
      { "u.beginAt": "2018-01-02" },
    ]);
    expect((filter as Loose)["u.beginAt"]).toBeInstanceOf(Date);
  });

  // ported from mongoose test/helpers/update.castArrayFilters.test.js:128 "handles deeply nested arrays (gh-7603)"
  test("handles deeply nested arrays (gh-7603) (divergence: '2' is not turned into 2, L1-1)", async () => {
    const filters = await arrayFilters(Arrays, { $set: { "arr.$[arr].nestedArr.$[nArr].code": true } }, [
      { "arr.nestedArr.nestedId": 2 },
      { "nArr.nestedId": 2 },
    ]);
    expect(filters).toEqual([{ "arr.nestedArr.nestedId": 2 }, { "nArr.nestedId": 2 }]);
    await expect(
      arrayFilters(Arrays, { $set: { "arr.$[arr].nestedArr.$[nArr].code": true } }, [
        { "arr.nestedArr.nestedId": "2" },
        { "nArr.nestedId": 2 },
      ]),
    ).rejects.toBeInstanceOf(CastError);
  });

  // ported from mongoose test/helpers/update.castArrayFilters.test.js:205 "respects `$or` option (gh-10696)"
  test("respects $or (gh-10696)", async () => {
    const [filter] = await arrayFilters(Arrays, { $set: { "arr.$[arr].id": 42 } }, [{ $or: [{ "arr.id": 12 }] }]);
    expect(filter).toEqual({ $or: [{ "arr.id": 12 }] });
    await expect(
      arrayFilters(Arrays, { $set: { "arr.$[arr].id": 42 } }, [{ $or: [{ "arr.nope": 12 }] }]),
    ).rejects.toBeInstanceOf(StrictModeError);
  });
});

describe("applyTimestampsToUpdate (ported)", () => {
  @Schema({ collection: "ported_timestamps" })
  class Titled extends Entity {
    @Prop(() => String)
    title?: string;

    @Prop(() => Date)
    updatedAt?: Date;
  }
  const Titles = new ModelOperations(Titled, capture);

  // ported from mongoose test/helpers/update.applyTimestampsToUpdate.test.js:7 "handles update pipelines (gh-11151)"
  test("handles update pipelines (gh-11151): Typemo timestamps come from Timestamped", async () => {
    const { Account } = await import("../../fixtures/steps/step-entities.ts");
    const Accounts = new ModelOperations(Account, capture);
    const ctx = await StepHarness.full(
      await capture.plan(Accounts.updateOne({ name: "a" }, (p) => p.set(() => ({ age: 1 })))),
    );
    const stages = ctx.update as Loose[];
    expect(stages).toHaveLength(2);
    expect((((stages[1] as Loose).$set as Loose).updatedAt as Loose).$literal).toBeInstanceOf(Date);
    const plain = await StepHarness.full(
      await capture.plan(Titles.updateOne({ title: "a" }, (p) => p.set(() => ({ title: "b" })))),
    );
    expect(plain.update as Loose[]).toHaveLength(1);
  });

  // ported from mongoose test/helpers/update.applyTimestampsToUpdate.test.js:16 "does not set createdAt unless upsert is enabled"
  test("does not set createdAt unless upsert is enabled", async () => {
    const { Account } = await import("../../fixtures/steps/step-entities.ts");
    const Accounts = new ModelOperations(Account, capture);
    const ctx = await StepHarness.full(await capture.plan(Accounts.updateOne({ name: "a" }, { $set: { age: 3 } })));
    const update = ctx.update as Record<string, Loose>;
    expect(Object.keys(update)).toEqual(["$set"]);
    expect(update.$set?.updatedAt).toBeInstanceOf(Date);
  });
});

describe("update validators and setDefaultsOnInsert (ported)", () => {
  // ported from mongoose test/model.updateOne.test.js:1648 "single nested with runValidators (gh-4420)"
  test("single nested with validators (gh-4420)", async () => {
    await mongo.db.collection("ported_companies").insertOne({ name: "Booster Fuels" });
    const ctx = await StepHarness.full(
      await capture.plan(
        new ModelOperations(Company, capture).updateOne(Filters.all(), { $set: { file: { name: "new-name" } } }),
      ),
    );
    expect(await RawExecute.run(mongo.db, ctx)).toMatchObject({ matchedCount: 1 });
  });

  // ported from mongoose test/model.updateOne.test.js:1666 "single nested under doc array with runValidators (gh-4960)"
  test("single nested under doc array with validators (gh-4960)", async () => {
    const Sellers = new ModelOperations(Seller, capture);
    const ctx = await StepHarness.full(
      await capture.plan(Sellers.updateOne(Filters.all(), { $set: { sell: [{ product: { name: "Product 1" } }] } })),
    );
    await RawExecute.run(mongo.db, ctx);
    // …and the required subdocument missing IS an issue (validators are always on):
    await expect(
      StepHarness.full(await capture.plan(Sellers.updateOne(Filters.all(), loose({ $set: { sell: [{}] } })))),
    ).rejects.toThrow(/required/);
  });

  // ported from mongoose test/model.findOneAndUpdate.test.js:1932 "$pull with `required` and runValidators (gh-6972)"
  test("$pull with a required inner field (gh-6972)", async () => {
    const Sellers = new ModelOperations(Seller, capture);
    const ctx = await StepHarness.full(
      await capture.plan(
        Sellers.findOneAndUpdate(
          loose({ _id: "507f191e810c19729de860ea" }),
          loose({ $pull: { sell: { "product.name": "x" } } }),
        ),
      ),
    );
    expect(await RawExecute.run(mongo.db, ctx)).toBeNull();
  });

  // ported from mongoose test/model.updateOne.test.js:1357 "versioning with setDefaultsOnInsert (gh-2593)"
  test("versioning with defaults on insert (gh-2593)", async () => {
    const Counters = new ModelOperations(Counter, capture);
    const ctx = await StepHarness.full(
      await capture.plan(
        Counters.updateOne(Filters.all(), { $inc: { num: 1 }, $push: { arr: { num: 5 } } }, { upsert: true }),
      ),
    );
    expect(await RawExecute.run(mongo.db, ctx)).toMatchObject({ upsertedCount: 1 });
  });

  // ported from mongoose test/model.test.js:4616 "setDefaultsOnInsert (gh-5708)"
  test("bulkWrite upsert applies defaults (gh-5708)", async () => {
    const plan: ExecutionPlan = {
      op: "bulkWrite",
      entity: WithDefault,
      ordered: true,
      options: {},
      operations: [{ updateOne: { filter: { num: 0 }, update: { $inc: { num: 1 } }, upsert: true } }],
    };
    const ctx = await StepHarness.full(plan);
    const [operation] = ctx.operations ?? [];
    const update = (operation as { updateOne: { update: Record<string, Loose> } }).updateOne.update;
    expect(update.$setOnInsert).toEqual({ str: "test" });
    await mongo.db.collection("ported_defaults").bulkWrite(loose(ctx.operations));
    const doc = (await mongo.db.collection("ported_defaults").findOne({})) as Document;
    expect(doc.str).toBe("test");
    expect(doc.num).toBe(1);
  });
});
