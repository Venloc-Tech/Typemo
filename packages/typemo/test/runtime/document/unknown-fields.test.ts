/*
 * A stored subdocument with fields the schema does not know (data of another schema version)
 * must not lose them silently. They are remembered at hydration (no extra query); a save that would REPLACE
 * such a subdocument or rewrite the array / Map / field holding it throws `UnknownFieldsError` and sends
 * nothing; `$save({ dropUnknownFields: true })` accepts the loss. Changes that keep the stored subdocument
 * (a field inside it, a push next to it) and deletions sent as their own operator (pull, pop, shift, Map
 * delete, $unset) are not losses; a whole rewrite that drops the subdocument (splice, clear, replace, Map
 * clear) is refused, the same as `set(i, v)`.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import {
  Entity,
  isUnknownFieldsError,
  type Model,
  Prop,
  Schema,
  Spec,
  type Subdocument,
  UnknownFieldsError,
  unknownFieldsOf,
} from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/**
 * A subdocument without `_id` (a subdocument `_id` is not immutable, see `subdocument-id.test.ts`):
 * the test is about unknown fields only.
 */
@Schema()
class Item {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number) qty?: number;
}

/** A nested object without `_id`. */
@Schema({ nested: true })
class Meta {
  @Prop(() => String) note?: string;
}

/** A root holding subdocuments in an array, a Map and single fields. */
@Schema({ collection: "k9_shelves" })
class Shelf extends Entity {
  @Prop(() => [Item]) items!: Item[];
  @Prop(() => Item) main?: Item;
  @Prop(() => Spec.map(Item)) byKey!: Map<string, Item>;
  @Prop(() => Meta) meta?: Meta;
  @Prop(() => String) label?: string;
}

const t = ModelLifecycle.useTypemo("k9_unknown_fields");
let Shelves: Model<Shelf>;
let id: ObjectId;

beforeEach(async () => {
  Shelves = t.connection.model(Shelf);
  id = new ObjectId();
  await t.mongo.db.collection("k9_shelves").insertOne({
    _id: id,
    items: [
      { name: "a", qty: 1, legacy: "L0" },
      { name: "b", qty: 2 },
    ],
    main: { name: "m", legacy: "LM", old: true },
    byKey: { k: { name: "k", legacy: "LK" } },
    meta: { note: "n", color: "red" },
    label: "x",
  });
  t.commands.clear();
});

/**
 * Reads the seeded shelf straight from the collection.
 * @returns The stored raw document.
 */
const stored = () => t.mongo.db.collection("k9_shelves").findOne({ _id: id });
/**
 * Loads the seeded shelf through the model.
 * @returns The hydrated shelf.
 */
const load = () => Shelves.findById(id).orFail();

/**
 * Asserts that the save throws `UnknownFieldsError` and sends nothing.
 * @param save The save to run.
 * @returns The error that was thrown.
 */
const refused = async (save: () => Promise<unknown>): Promise<UnknownFieldsError> => {
  t.commands.clear();
  let caught: unknown;
  try {
    await save();
  } catch (error) {
    caught = error;
  }
  expect(isUnknownFieldsError(caught)).toBe(true);
  expect(t.commands.byName("update")).toEqual([]);
  return caught as UnknownFieldsError;
};

describe("unknown fields are known from the read, without a query", () => {
  test("unknownFieldsOf lists them; the read sent one find", async () => {
    const shelf = await load();
    expect(t.commands.all().map((command) => command.commandName)).toEqual(["find"]);
    expect(unknownFieldsOf(shelf)).toEqual([
      { path: "items.0", keys: ["legacy"] },
      { path: "main", keys: ["legacy", "old"] },
      { path: "byKey.k", keys: ["legacy"] },
      { path: "meta", keys: ["color"] },
    ]);
    expect(unknownFieldsOf(shelf.items)).toEqual([{ path: "items.0", keys: ["legacy"] }]);
    expect(unknownFieldsOf(shelf.items[1] as Subdocument<Item>)).toEqual([]);
  });
});

describe("changes that keep the stored subdocument", () => {
  test("a field inside it, a push next to it, a scalar of the root: saved, the unknown fields stay", async () => {
    const shelf = await load();
    (shelf.items[0] as Subdocument<Item>).qty = 5;
    (shelf.main as Subdocument<Item>).qty = 9;
    shelf.label = "y";
    await shelf.$save();
    shelf.items.push({ name: "c" });
    await shelf.$save();
    const doc = await stored();
    expect(doc?.items[0]).toMatchObject({ name: "a", qty: 5, legacy: "L0" });
    expect(doc?.main).toMatchObject({ qty: 9, legacy: "LM", old: true });
  });

  test("deletions are not losses: pull, Map delete, $unset of the field", async () => {
    const shelf = await load();
    shelf.items.pull(shelf.items[0] as Subdocument<Item>);
    shelf.byKey.delete("k");
    delete shelf.main;
    await shelf.$save();
    const doc = await stored();
    expect(doc?.items.map((item: { name: string }) => item.name)).toEqual(["b"]);
    expect(doc?.byKey).toEqual({});
    expect(doc?.main).toBeUndefined();
  });
});

describe("a replacement or a whole rewrite is refused by default", () => {
  test("an atomic next to a change inside an element rewrites the array (server code 40): refused", async () => {
    const shelf = await load();
    (shelf.items[0] as Subdocument<Item>).qty = 5;
    shelf.items.push({ name: "c" });
    expect((await refused(() => shelf.$save())).fields).toEqual([{ path: "items.0", keys: ["legacy"] }]);
  });

  test("set(i, v) of an element with unknown fields", async () => {
    const shelf = await load();
    shelf.items.set(0, { name: "new" });
    const error = await refused(() => shelf.$save());
    expect(error.fields).toEqual([{ path: "items.0", keys: ["legacy"] }]);
    expect(error.message).toMatch(/dropUnknownFields/);
  });

  test("a whole rewrite of the array keeps the element but drops its unknown fields", async () => {
    const shelf = await load();
    shelf.items.reverse();
    const error = await refused(() => shelf.$save());
    expect(error.fields).toEqual([{ path: "items.1", keys: ["legacy"] }]);
  });

  test("$set of a subdocument field, of a nested object, a Map entry", async () => {
    const one = await load();
    one.$set("main", { name: "other" });
    expect((await refused(() => one.$save())).fields).toEqual([{ path: "main", keys: ["legacy", "old"] }]);
    const two = await load();
    two.$set("meta", { note: "z" });
    expect((await refused(() => two.$save())).fields).toEqual([{ path: "meta", keys: ["color"] }]);
    const three = await load();
    three.byKey.set("k", { name: "k2" });
    expect((await refused(() => three.$save())).fields).toEqual([{ path: "byKey.k", keys: ["legacy"] }]);
  });

  test("replace([...]) without the element with unknown fields", async () => {
    const shelf = await load();
    shelf.items.replace([{ name: "only" }]);
    const error = await refused(() => shelf.$save());
    expect(error.fields).toEqual([{ path: "items.0", keys: ["legacy"] }]);
  });

  test("replace([...]) that keeps the element still rewrites it: refused once", async () => {
    const shelf = await load();
    const first = shelf.items[0] as Subdocument<Item>;
    shelf.items.replace([first]);
    expect((await refused(() => shelf.$save())).fields).toEqual([{ path: "items.0", keys: ["legacy"] }]);
  });

  test("clear() of the array", async () => {
    const shelf = await load();
    shelf.items.clear();
    expect((await refused(() => shelf.$save())).fields).toEqual([{ path: "items.0", keys: ["legacy"] }]);
  });

  test("splice(0, 1) of the element", async () => {
    const shelf = await load();
    shelf.items.splice(0, 1);
    expect((await refused(() => shelf.$save())).fields).toEqual([{ path: "items.0", keys: ["legacy"] }]);
  });

  test("splice of another element still rewrites the kept one: refused", async () => {
    const shelf = await load();
    shelf.items.splice(1, 1, { name: "c" });
    expect((await refused(() => shelf.$save())).fields).toEqual([{ path: "items.0", keys: ["legacy"] }]);
  });

  test("clear() of a Map", async () => {
    const shelf = await load();
    shelf.byKey.clear();
    expect((await refused(() => shelf.$save())).fields).toEqual([{ path: "byKey.k", keys: ["legacy"] }]);
  });

  test("pop() and shift() are deletions, not losses", async () => {
    const one = await load();
    one.items.shift();
    await one.$save();
    expect((await stored())?.items.map((item: { name: string }) => item.name)).toEqual(["b"]);
  });

  test("$markModified of the field rewrites it whole", async () => {
    const shelf = await load();
    shelf.$markModified("items");
    expect((await refused(() => shelf.$save())).fields).toEqual([{ path: "items.0", keys: ["legacy"] }]);
  });

  test("$getChanges previews the same refusal; the document keeps its changes", async () => {
    const shelf = await load();
    shelf.items.set(0, { name: "new" });
    /* The preview never throws: it marks the path with the message the save throws. */
    expect(shelf.$getChanges().$problems?.["items.0"]).toContain("legacy");
    expect(shelf.$isModified("items")).toBe(true);
  });
});

describe("dropUnknownFields accepts the loss", () => {
  test("$save({ dropUnknownFields: true }) writes; the instances forget the keys", async () => {
    const shelf = await load();
    shelf.items.reverse();
    await shelf.$save({ dropUnknownFields: true });
    const doc = await stored();
    expect(doc?.items.map((item: Record<string, unknown>) => Object.keys(item).sort())).toEqual([
      ["name", "qty"],
      ["name", "qty"],
    ]);
    expect(Object.keys(shelf.items[1] as object)).not.toContain("legacy");
    expect(unknownFieldsOf(shelf.items)).toEqual([]);
    /* the other stored subdocuments keep theirs */
    expect(doc?.main).toMatchObject({ legacy: "LM" });
    shelf.items.reverse();
    await shelf.$save();
  });

  test("clear(), splice() and replace() are written with the option", async () => {
    const shelf = await load();
    shelf.items.splice(0, 1);
    await shelf.$save({ dropUnknownFields: true });
    expect((await stored())?.items).toEqual([{ name: "b", qty: 2 }]);
    shelf.byKey.clear();
    shelf.items.clear();
    await shelf.$save({ dropUnknownFields: true });
    const doc = await stored();
    expect(doc?.items).toEqual([]);
    expect(doc?.byKey).toEqual({});
  });

  test("a replaced subdocument is simply gone", async () => {
    const shelf = await load();
    shelf.$set("main", { name: "other" });
    await shelf.$save({ dropUnknownFields: true });
    expect((await stored())?.main).toMatchObject({ name: "other" });
    expect((await stored())?.main).not.toHaveProperty("legacy");
  });

  test("bulkSave: refused as a whole by default, accepted with the option", async () => {
    const one = await load();
    const other = await Shelves.create({ items: [], byKey: {} });
    other.label = "o";
    one.items.set(0, { name: "new" });
    t.commands.clear();
    await expect(Shelves.bulkSave([other, one])).rejects.toThrow(UnknownFieldsError);
    expect(t.commands.byName("update")).toEqual([]);
    expect(other.$isModified("label")).toBe(true);
    await Shelves.bulkSave([other, one], { dropUnknownFields: true });
    expect((await stored())?.items[0]).toMatchObject({ name: "new" });
    expect(one.$isModified()).toBe(false);
  });
});
