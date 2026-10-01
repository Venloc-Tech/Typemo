/*
 * The high-risk entries of history.yaml (data loss, security) that had no test.
 * Each test names its entry; the reason for every entry still uncovered is in
 * packages/typemo/test/regressions/HISTORY-NOTES.md.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { Entity, type Model, Prop, Schema, StrictModeError } from "../../../src/index.ts";
import { Order } from "../../fixtures/document/document-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

@Schema()
class Settings {
  @Prop(() => String) theme?: string;
}

@Schema({ collection: "r10_profiles" })
class Profile extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Settings, { required: true }) settings!: Settings;
  @Prop(() => Settings) extra?: Settings;

  /** A method: stored data under the same name must never replace it (H474). */
  describe(): string {
    return `profile ${this.name}`;
  }
}

const t = ModelLifecycle.useTypemo("r10_history");
let Profiles: Model<Profile>;
let Orders: Model<Order>;
const raw = () => t.mongo.db.collection("r10_profiles");
const loose = (value: unknown): never => value as never;

beforeEach(() => {
  Profiles = t.connection.model(Profile);
  Orders = t.connection.model(Order);
  t.commands.clear();
});

describe("history.yaml, high risk", () => {
  test("H069: prototype names as paths (constructor, toString, __proto__) are unknown paths, never a crash", async () => {
    for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const filter = JSON.parse(`{ "${key}": 1 }`);
      await expect(Profiles.find(loose(filter)).exec()).rejects.toBeInstanceOf(StrictModeError);
    }
    const found = await raw().insertOne({ name: "p", settings: {}, constructor: "x", toString: "y" });
    const doc = await Profiles.findById(found.insertedId).orFail();
    expect(typeof doc.toString).toBe("function");
    expect(doc.$toObject()).toEqual({ _id: found.insertedId, name: "p", settings: {} });
  });

  test("H474: stored data never replaces a method or the root _id (a nested _id the schema lacks is unknown)", async () => {
    const id = new ObjectId();
    await raw().insertOne({ _id: id, name: "p", settings: { _id: new ObjectId(), theme: "dark" }, describe: "data" });
    const doc = await Profiles.findById(id).orFail();
    expect(doc.describe()).toBe("profile p");
    expect(doc._id).toEqual(id);
    expect(doc.settings.theme).toBe("dark");
    expect("_id" in doc.$toObject().settings).toBe(false);
  });

  test("H354: minimize is off — an empty required subdocument is saved as {} and read back, no required error", async () => {
    const doc = await Profiles.create({ name: "empty", settings: {} });
    expect((await raw().findOne({ _id: doc._id }))?.settings).toEqual({});
    const read = await Profiles.findById(doc._id).orFail();
    read.name = "still empty";
    await read.$save();
    expect((await raw().findOne({ _id: doc._id }))?.settings).toEqual({});
  });

  test("H078: a save that is both positional and structural keeps BOTH version rules (filter by __v AND $inc)", async () => {
    const order = await Orders.create({ customer: "ann", tags: ["a", "b"], lines: [{ sku: "s", qty: 1 }] });
    const doc = await Orders.findById(order._id).orFail();
    t.commands.clear();
    doc.tags.set(0, "z"); // positional: the filter carries __v
    doc.lines.pull(doc.lines[0]?._id as ObjectId); // structural: the version is incremented
    await doc.$save();
    const [update] = t.commands.byName("update");
    const updates = update?.command.updates as { q: Record<string, unknown>; u: Record<string, unknown> }[] | undefined;
    const statement = updates?.[0];
    expect(statement?.q.__v).toBe(0);
    expect(statement?.u.$inc).toEqual({ __v: 1 });
    expect((await t.mongo.db.collection("d_orders").findOne({ _id: order._id }))?.__v).toBe(1);
  });
});
