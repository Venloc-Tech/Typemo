/*
 * Every awaitable builder is a `Promise` of its result, at run time and in the types: `then`, `catch`, `finally`
 * and the `Symbol.toStringTag` tag, so a non-`async` function can return a query where a `Promise` is expected
 * (`(id): Promise<HydratedDoc<Imaged>> => Imageds.findById(id).orFail()`). Covers the query builder, the write
 * builder, the count and value queries, the aggregation, the masked and the parsed queries.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { ObjectId } from "mongodb";
import { DocumentNotFoundError, type HydratedDoc, type UpdateResult } from "../../../src/index.ts";
import { Imaged } from "../../fixtures/mechanisms/storage-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("w5_promise");

beforeEach(async () => {
  await t.connection.model(Imaged).deleteMany({ n: { $gte: 0 } });
});

/** The tag every builder prints. */
const TAG = "[object TypemoQuery]";

describe("a builder is a Promise of its result", () => {
  test("query builder: returned as a Promise from a non-async function, catch and finally run it", async () => {
    const Imageds = t.connection.model(Imaged);
    const created = await Imageds.create({ name: "a", n: 1 });
    const load = (id: ObjectId): Promise<HydratedDoc<Imaged>> => Imageds.findById(id).orFail();
    const plainClass = (id: ObjectId): Promise<Imaged> => Imageds.findById(id).orFail();
    expect((await load(created._id)).name).toBe("a");
    expect((await plainClass(created._id)).n).toBe(1);
    const query = Imageds.find({ n: 1 }).lean();
    expect(Object.prototype.toString.call(query)).toBe(TAG);
    expect(query[Symbol.toStringTag]).toBe("TypemoQuery");
    let settled = false;
    const rows = await query.finally(() => {
      settled = true;
    });
    expect([settled, rows.length]).toEqual([true, 1]);
    const missing = Imageds.findOne({ name: "none" })
      .orFail()
      .catch((error: unknown) => error);
    expect(await missing).toBeInstanceOf(DocumentNotFoundError);
  });

  test("write, count and value queries", async () => {
    const Imageds = t.connection.model(Imaged);
    await Imageds.create({ name: "b", n: 2 });
    const write = (): Promise<UpdateResult<ObjectId>> => Imageds.updateOne({ name: "b" }, { $set: { n: 3 } });
    expect((await write()).modifiedCount).toBe(1);
    const count = (): Promise<number> => Imageds.countDocuments({ n: 3 });
    expect(await count()).toBe(1);
    const estimated = Imageds.estimatedDocumentCount();
    expect(Object.prototype.toString.call(estimated)).toBe(TAG);
    expect(await estimated.finally(() => undefined)).toBe(1);
    const values = (): Promise<string[]> => Imageds.distinct("name");
    expect(await values()).toEqual(["b"]);
  });

  test("aggregation: then, catch, finally and the tag", async () => {
    const Imageds = t.connection.model(Imaged);
    await Imageds.create({ name: "c", n: 4 });
    const aggregation = Imageds.aggregate((p) => p.match({ n: 4 }).project({ _id: 0, name: 1 }));
    const rows = (): Promise<{ name: string }[]> => aggregation;
    expect(await rows()).toEqual([{ name: "c" }]);
    expect(Object.prototype.toString.call(aggregation)).toBe(TAG);
    let settled = false;
    await aggregation.finally(() => {
      settled = true;
    });
    expect(settled).toBe(true);
    expect(await aggregation.catch(() => [])).toEqual([{ name: "c" }]);
  });

  test("masked and parsed queries", async () => {
    const Imageds = t.connection.model(Imaged);
    await Imageds.create({ name: "secret", n: 5 });
    const masked = Imageds.find({ n: 5 }).lean().mask({ name: "mask" });
    expect(Object.prototype.toString.call(masked)).toBe(TAG);
    const maskedRows = await masked.finally(() => undefined);
    expect(maskedRows[0]?.name).not.toBe("secret");
    const parsed = Imageds.find({ n: 5 }).lean().parse(Imageds);
    expect(Object.prototype.toString.call(parsed)).toBe(TAG);
    expect((await parsed.catch(() => [])).length).toBe(1);
  });
});

describe("the types", () => {
  test("every builder is assignable to a Promise of its result", () => {
    const Imageds = t.connection.model(Imaged);
    expectTypeOf(Imageds.find().lean()).toExtend<Promise<unknown[]>>();
    expectTypeOf(Imageds.countDocuments()).toExtend<Promise<number>>();
    expectTypeOf(Imageds.aggregate((p) => p.match({ n: 1 }))).toExtend<Promise<unknown[]>>();
    expectTypeOf(Imageds.find().lean().mask({ name: "mask" })).toExtend<Promise<unknown[]>>();
    // @ts-expect-error the result type is still checked: a list is not a Promise of one document
    const wrong: Promise<HydratedDoc<Imaged>> = Imageds.find();
    expect(wrong).toBeDefined();
  });
});
