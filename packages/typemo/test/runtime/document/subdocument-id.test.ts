/*
 * `immutable` of `_id` binds the ROOT `_id` only. A subdocument whose class
 * extends `Entity` (so it has an immutable `_id`) can be replaced whole — as an array element or a single
 * subdocument — with a new element `_id`: through the document (`SubdocumentArray.set`, `$set`) and through
 * an update (`$set: { "lines.0": … }`). The root `_id` stays immutable.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { Entity, type Model, Prop, Schema, StrictModeError } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** A subdocument that extends `Entity`, so it has its own `_id`. */
@Schema()
class Line extends Entity {
  @Prop(() => String, { required: true }) sku!: string;
}

/** A root with an array of lines and a single line. */
@Schema({ collection: "l2_carts" })
class Cart extends Entity {
  @Prop(() => [Line]) lines!: Line[];
  @Prop(() => Line) main?: Line;
}

const t = ModelLifecycle.useTypemo("l2_subdocument_id");
let Carts: Model<Cart>;
let id: ObjectId;
const first = new ObjectId();

beforeEach(async () => {
  Carts = t.connection.model(Cart);
  const cart = await Carts.create({ lines: [{ _id: first, sku: "a" }, { sku: "b" }], main: { sku: "m" } });
  id = cart._id;
});

describe("a subdocument's _id is not immutable", () => {
  test("SubdocumentArray.set(i, element with a new _id) is saved", async () => {
    const cart = await Carts.findById(id).orFail();
    const replacement = new ObjectId();
    cart.lines.set(0, { _id: replacement, sku: "z" });
    await cart.$save();
    const stored = await Carts.findById(id).orFail().lean();
    expect(stored.lines[0]).toEqual({ _id: replacement, sku: "z" });
    expect(stored.lines[1]?.sku).toBe("b");
  });

  test("replacing a single subdocument (new _id) through $set is saved", async () => {
    const cart = await Carts.findById(id).orFail();
    const replacement = new ObjectId();
    cart.$set("main", { _id: replacement, sku: "n" });
    await cart.$save();
    expect((await Carts.findById(id).orFail().lean()).main).toEqual({ _id: replacement, sku: "n" });
  });

  test("updates: $set of an element, of an element's _id, of a whole subdocument", async () => {
    const a = new ObjectId();
    const b = new ObjectId();
    await Carts.updateOne({ _id: id }, { $set: { "lines.0": { _id: a, sku: "x" } } });
    await Carts.updateOne({ _id: id }, { $set: { "lines.1._id": b } });
    await Carts.updateOne({ _id: id }, { $set: { main: { sku: "q" } } });
    const stored = await Carts.findById(id).orFail().lean();
    expect(stored.lines.map((line) => line._id)).toEqual([a, b]);
    expect(stored.main?.sku).toBe("q");
  });

  test("the root _id is still immutable", async () => {
    await expect(
      Carts.updateOne({ _id: id }, { $set: { _id: new ObjectId() } } as never).exec(),
    ).rejects.toBeInstanceOf(StrictModeError);
  });
});

describe("SubdocumentArray.id() and pull() take the string form of the id", () => {
  test("id(hex) finds the element, pull(hex) removes it and the save writes $pull", async () => {
    const cart = await Carts.findById(id).orFail();
    expect(cart.lines.id(first.toHexString())?.sku).toBe("a");
    cart.lines.pull(first.toHexString());
    await cart.$save();
    const stored = await Carts.findById(id).orFail().lean();
    expect(stored.lines.map((line) => line.sku)).toEqual(["b"]);
  });
});
