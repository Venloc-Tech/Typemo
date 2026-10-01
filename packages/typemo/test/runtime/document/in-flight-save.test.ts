/*
 * Changes made to the collections of a document WHILE its save is in flight
 * — during the async validation or while the write itself is on the wire — are never lost after the
 * write succeeds, and a failed write gives the journals back. The write is delayed for real on the server
 * (`failCommand` with `blockConnection`), the change happens once the command has started.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type FailPointHandle, FailPointHelpers } from "@venloc/typemo-test-kit";
import type { ObjectId } from "mongodb";
import { Entity, type Model, Prop, Schema, Spec } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** An embedded item of a basket. */
@Schema()
class Item extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number) qty?: number;
}

/** The gate of the async validator of `Basket.label` (a test opens it). */
class Gate {
  static waiting: (() => void) | undefined;
  static entered = false;
  static closed = false;
}

/** A root with an array, a subdocument array and a Map, and a validator a test can hold open. */
@Schema({ collection: "k4_baskets" })
class Basket extends Entity {
  @Prop(() => String, {
    validate: async (): Promise<true> => {
      if (!Gate.closed) return true;
      Gate.entered = true;
      await new Promise<void>((resolve) => {
        Gate.waiting = resolve;
      });
      return true;
    },
  })
  label?: string;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => [Item]) items!: Item[];
  @Prop(() => Spec.map(Number)) counts!: Map<string, number>;
}

const t = ModelLifecycle.useTypemo("k4_in_flight");
let Baskets: Model<Basket>;
let failpoint: FailPointHandle | undefined;

beforeEach(() => {
  Baskets = t.connection.model(Basket);
  Gate.closed = false;
  Gate.entered = false;
  Gate.waiting = undefined;
  t.commands.clear();
});

afterEach(async () => {
  await failpoint?.disable();
  failpoint = undefined;
});

/**
 * Reads a basket straight from the collection.
 * @param id The basket id.
 * @returns The stored raw document.
 */
const stored = (id: ObjectId) => t.mongo.db.collection("k4_baskets").findOne({ _id: id });

/**
 * Resolves once the Typemo client has sent `command` (the write is then blocked on the server).
 * @param command The command name to wait for.
 * @param count How many times it must have been sent.
 */
const started = async (command: string, count = 1): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (t.commands.byName(command).length < count) {
    if (Date.now() > deadline) throw new Error(`${command} was not sent`);
    await Bun.sleep(2);
  }
};

/**
 * Makes the next matching command block on the server for a while.
 * @param command The command to delay.
 * @param extra Extra failpoint data.
 */
const delay = async (command: string, extra: Record<string, unknown> = {}): Promise<void> => {
  failpoint = await FailPointHelpers.configureFailCommand(t.mongo.client, {
    failCommands: [command],
    blockConnection: true,
    blockTimeMS: 250,
    times: 1,
    ...extra,
  });
};

/**
 * The update documents of the update commands sent so far.
 * @returns One update document per command.
 */
const updates = () =>
  t.commands.byName("update").map((command) => command.updates[0]?.update as Record<string, unknown>);

describe("changes made while the write is in flight", () => {
  test("an update: push / subdocument field / Map entry made in flight stay changes, the next save sends them", async () => {
    const created = await Baskets.create({ tags: ["a"], items: [{ name: "x", qty: 1 }], counts: { a: 1 } });
    const basket = await Baskets.findById(created._id).orFail();
    basket.tags.push("b");
    t.commands.clear();
    await delay("update");
    const saving = basket.$save();
    await started("update");
    basket.tags.push("c");
    (basket.items[0] as Item).qty = 2;
    basket.counts.set("b", 2);
    await saving;
    expect(updates()[0]).toEqual({ $push: { tags: { $each: ["b"] } } });
    expect(basket.$isModified("tags")).toBe(true);
    expect(basket.$isModified("items.0.qty")).toBe(true);
    expect(basket.$isModified("counts")).toBe(true);
    await basket.$save();
    expect(updates()[1]).toEqual({
      $push: { tags: { $each: ["c"] } },
      $set: { "items.0.qty": 2, "counts.b": 2 },
    });
    expect(await stored(created._id)).toMatchObject({
      tags: ["a", "b", "c"],
      items: [{ name: "x", qty: 2 }],
      counts: { a: 1, b: 2 },
    });
    expect(basket.$isModified()).toBe(false);
  });

  test("an insert: a push made while the insert is in flight is sent by the next save", async () => {
    const basket = Baskets.new({ tags: ["a"], items: [], counts: {} });
    await delay("insert");
    const saving = basket.$save();
    await started("insert");
    basket.tags.push("late");
    basket.items.push({ name: "late" });
    await saving;
    expect(basket.$isNew()).toBe(false);
    expect(basket.$isModified("tags")).toBe(true);
    await basket.$save();
    const doc = await stored(basket._id);
    expect(doc?.tags).toEqual(["a", "late"]);
    expect((doc?.items as { name: string }[] | undefined)?.map((item) => item.name)).toEqual(["late"]);
  });

  test("a change made during the async validation is not lost either", async () => {
    const created = await Baskets.create({ tags: [], items: [], counts: {} });
    const basket = await Baskets.findById(created._id).orFail();
    basket.label = "l1";
    basket.tags.push("a");
    Gate.closed = true;
    const saving = basket.$save();
    while (!Gate.entered) await Bun.sleep(1);
    basket.tags.push("b");
    basket.label = "l2";
    Gate.closed = false;
    Gate.waiting?.();
    await saving;
    expect(updates()[0]).toEqual({ $set: { label: "l1" }, $push: { tags: { $each: ["a"] } } });
    await basket.$save();
    expect(await stored(created._id)).toMatchObject({ label: "l2", tags: ["a", "b"] });
  });

  test("a failed write gives the journals back: the same ops again", async () => {
    const created = await Baskets.create({ tags: [], items: [], counts: {} });
    const basket = await Baskets.findById(created._id).orFail();
    basket.tags.push("a");
    basket.counts.set("k", 1);
    await delay("update", { errorCode: 2, blockConnection: false });
    await expect(basket.$save()).rejects.toThrow();
    expect(basket.$isModified("tags")).toBe(true);
    await basket.$save();
    expect(updates().at(-1)).toEqual({ $push: { tags: { $each: ["a"] } }, $set: { "counts.k": 1 } });
    expect(await stored(created._id)).toMatchObject({ tags: ["a"], counts: { k: 1 } });
  });

  test("a failed write with an in-flight change: that array is written whole, nothing is lost", async () => {
    const created = await Baskets.create({ tags: ["x"], items: [], counts: {} });
    const basket = await Baskets.findById(created._id).orFail();
    basket.tags.push("a");
    t.commands.clear();
    await delay("update", { errorCode: 2, blockTimeMS: 150 });
    const saving = basket.$save();
    await started("update");
    basket.tags.push("b");
    await expect(saving).rejects.toThrow();
    await basket.$save();
    expect(updates().at(-1)).toEqual({ $set: { tags: ["x", "a", "b"] } });
    expect((await stored(created._id))?.tags).toEqual(["x", "a", "b"]);
  });

  test("a $markModified added in flight stays for the next save", async () => {
    const created = await Baskets.create({ tags: ["a"], items: [], counts: {} });
    const basket = await Baskets.findById(created._id).orFail();
    basket.label = "x";
    await delay("update");
    const saving = basket.$save();
    await started("update");
    basket.$markModified("tags");
    await saving;
    expect(basket.$isModified("tags")).toBe(true);
    await basket.$save();
    expect(updates().at(-1)).toEqual({ $set: { tags: ["a"] } });
  });
});
