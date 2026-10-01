/*
 * The plain forms the types accept back are accepted at run time on the real server: a `Decimal128` as its decimal
 * string, a `Vector` as its numbers — in create, an update and a filter.
 */
import { describe, expect, test } from "bun:test";
import { Decimal128 } from "mongodb";
import { Entity, Prop, Schema, Spec, Types, type Vector } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** A price and an embedding. */
@Schema({ collection: "f61_items" })
class Priced extends Entity {
  @Prop(() => Types.Decimal128) price?: Types.Decimal128;
  @Prop(() => Spec.vector({ dtype: "float32", dimensions: 3 })) values?: Vector;
}

const t = ModelLifecycle.useTypemo("f61_forms");

describe("plain input forms of Decimal128 and Vector", () => {
  test("create, update and filter take the decimal string and the numbers", async () => {
    const Items = t.connection.model(Priced);
    const item = await Items.create({ price: "1.10", values: [1, 2, 3] });
    expect(item.price).toEqual(Decimal128.fromString("1.10"));
    expect(item.$toPlain().values).toEqual([1, 2, 3]);
    await Items.updateOne({ _id: item._id }, { $set: { price: "2.50", values: [0.5, 0.25, 1] } });
    const found = await Items.findOne({ price: "2.50" }).plain().orFail();
    expect(found.price).toBe("2.50");
    expect(found.values).toEqual([0.5, 0.25, 1]);
  });
});
