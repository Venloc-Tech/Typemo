/*
 * Fast hydration keeps every behaviour. Real server.
 * - The baseline keeps values by identity; a `Date` is compared by its time at the reset, so an in-place
 *   `setTime` is a change at every depth, before and after a save; the same time again is no change.
 * - A loaded value is known to be cast (a user `set` is not run again at save).
 * - Plain assignment instead of `defineProperty`, `clean` skipped when the constructor leaves nothing: the
 *   same own enumerable data properties (`Object.keys`, spread, `JSON.stringify`, `structuredClone`, `hasOwn`,
 *   descriptors), also for a class whose constructor sets fields.
 * - Access tracking only for arrays of objects longer than 50 elements; 49 and 50 elements
 *   compare every element, 51 track the accessed ones — changes are found either way. An array that grows past 50
 *   switches at once, and every element it held counts as accessed.
 * - Unknown stored keys — the key count only for driver records, the exact check for `Model.hydrate(raw)`.
 * - A stored key equal to the CODE name of a field renamed by `dbName` (data from before the
 *   rename) is not put on the (sub)document: the document is loaded unchanged, a save writes nothing extra.
 * - `Model.hydrate(raw)` reads schema fields from `raw`'s own properties only (never its prototype).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { MARK } from "../../../src/document/collections/tracked-protocol.ts";
import { DirectWriteError, type HydratedDoc, type Model } from "../../../src/index.ts";
import { Order, SetterLog } from "../../fixtures/document/document-entities.ts";
import { PerfEvent, PerfInitialized, PerfRenamed } from "../../fixtures/document/perf-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("perf_a_hydration");
let Events: Model<PerfEvent>;

const T0 = 1_700_000_000_000;
/**
 * Raw order lines with consecutive times.
 * @param count How many lines to build.
 * @returns The raw lines.
 */
const lines = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ _id: new ObjectId(), sku: `s${i}`, qty: i, at: new Date(T0 + i) }));

/**
 * Inserts an event with the given number of lines.
 * @param count How many lines the event has.
 * @returns The id of the inserted event.
 */
const seed = async (count = 3): Promise<ObjectId> => {
  const _id = new ObjectId();
  await t.mongo.db.collection("perf_events").insertOne({
    _id,
    name: "e",
    when: new Date(T0),
    window: { from: new Date(T0), to: new Date(T0 + 1000) },
    lines: lines(count),
    tags: ["a", "b"],
  });
  return _id;
};

/**
 * Loads an event through the model.
 * @param id The event id.
 * @returns The hydrated event.
 */
const load = async (id: ObjectId): Promise<HydratedDoc<PerfEvent>> => await Events.findById(id).orFail();
/**
 * Reads an event straight from the collection.
 * @param id The event id.
 * @returns The stored raw document.
 */
const stored = (id: ObjectId) => t.mongo.db.collection("perf_events").findOne({ _id: id });

beforeEach(() => {
  Events = t.connection.model(PerfEvent);
});

describe("a Date changed in place is a change", () => {
  test("root: setTime is found, saved, and found again after the save", async () => {
    const id = await seed();
    const doc = await load(id);
    expect(doc.$isModified()).toBe(false);
    doc.when?.setTime(T0 + 5);
    expect(doc.$isModified("when")).toBe(true);
    expect(doc.$getChanges()).toEqual({ $set: { when: new Date(T0 + 5) } });
    await doc.$save();
    expect((await stored(id))?.when).toEqual(new Date(T0 + 5));
    expect(doc.$isModified()).toBe(false);
    doc.when?.setTime(T0 + 6);
    expect(doc.$isModified("when")).toBe(true);
    await doc.$save();
    expect((await stored(id))?.when).toEqual(new Date(T0 + 6));
  });

  test("root: the same time again (in place, or a new Date) is no change", async () => {
    const doc = await load(await seed());
    doc.when?.setTime(T0 + 5);
    doc.when?.setTime(T0);
    expect(doc.$isModified()).toBe(false);
    doc.when = new Date(T0);
    expect(doc.$isModified()).toBe(false);
    expect(doc.$getChanges()).toEqual({});
  });

  test("a nested object and a subdocument of an array: setTime is found", async () => {
    const id = await seed();
    const doc = await load(id);
    doc.window?.to?.setTime(T0 + 99);
    const line = doc.lines[1];
    line?.at?.setTime(T0 + 42);
    expect(doc.$getChanges()).toEqual({ $set: { "window.to": new Date(T0 + 99), "lines.1.at": new Date(T0 + 42) } });
    await doc.$save();
    const after = await stored(id);
    expect(after?.window.to).toEqual(new Date(T0 + 99));
    expect(after?.lines[1].at).toEqual(new Date(T0 + 42));
    /* After the save the baseline is the saved time: in place again is a change again. */
    doc.window?.to?.setTime(T0 + 100);
    expect(doc.$getChanges()).toEqual({ $set: { "window.to": new Date(T0 + 100) } });
  });

  test("an aborted transaction restores the baseline time: the in-place change is a change again", async () => {
    const id = await seed();
    const doc = await load(id);
    doc.when?.setTime(T0 + 7);
    const error = await t.connection
      .transaction(async () => {
        await doc.$save();
        throw new Error("abort");
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((await stored(id))?.when).toEqual(new Date(T0));
    expect(doc.$isModified("when")).toBe(true);
    await doc.$save();
    expect((await stored(id))?.when).toEqual(new Date(T0 + 7));
    expect(doc.$isModified()).toBe(false);
  });
});

describe("a loaded value is not cast again", () => {
  test("a field with a user set: the setter does not run for a loaded value at save", async () => {
    const Orders = t.connection.model(Order);
    const order = await Orders.create({ customer: "ann", tags: [], lines: [], code: "ABC" });
    const loaded = await Orders.findById(order._id).orFail();
    SetterLog.calls = 0;
    loaded.customer = "bob";
    await loaded.$save();
    expect(SetterLog.calls).toBe(0);
    expect(loaded.code).toBe("abc");
    /* A value assigned directly is cast once at the save. */
    loaded.code = "XYZ";
    await loaded.$save();
    expect(SetterLog.calls).toBe(1);
    expect(loaded.code).toBe("xyz");
  });
});

describe("the same own data properties as defineProperty", () => {
  const checkDataProperties = (doc: object): void => {
    for (const key of Object.keys(doc)) {
      const descriptor = Object.getOwnPropertyDescriptor(doc, key);
      expect(descriptor).toMatchObject({ enumerable: true, writable: true, configurable: true });
      expect(descriptor?.get).toBeUndefined();
    }
  };

  test("keys in schema order, spread, JSON, structuredClone and hasOwn see exactly the data", async () => {
    const id = await seed();
    const doc = await load(id);
    expect(Object.keys(doc)).toEqual(["_id", "name", "when", "window", "lines", "tags"]);
    checkDataProperties(doc);
    checkDataProperties(doc.window as object);
    checkDataProperties(doc.lines[0] as object);
    expect(Object.hasOwn(doc, "name")).toBe(true);
    expect(Object.hasOwn(doc, "missing")).toBe(false);
    const spread = { ...doc };
    expect(Object.keys(spread)).toEqual(Object.keys(doc));
    expect(JSON.parse(JSON.stringify(doc))).toEqual(JSON.parse(JSON.stringify(doc.$toJSON())));
    const clone = structuredClone({ name: doc.name, window: { ...doc.window }, tags: [...doc.tags] });
    expect(clone).toEqual({ name: "e", window: { from: new Date(T0), to: new Date(T0 + 1000) }, tags: ["a", "b"] });
  });

  test("a constructor that leaves own undefined fields: they are removed on every document (E3, A5)", async () => {
    const Initialized = t.connection.model(PerfInitialized);
    const _id = new ObjectId();
    await t.mongo.db.collection("perf_initialized").insertOne({ _id, name: "n", score: 3 });
    const other = new ObjectId();
    await t.mongo.db.collection("perf_initialized").insertOne({ _id: other, name: "m" });
    for (let round = 0; round < 2; round++) {
      const doc = await Initialized.findById(_id).orFail();
      expect(doc.score).toBe(3);
      expect(Object.hasOwn(doc, "note")).toBe(false);
      expect(Object.keys(doc)).toEqual(["_id", "name", "score"]);
      checkDataProperties(doc);
      const without = await Initialized.findById(other).orFail();
      expect(Object.hasOwn(without, "note")).toBe(false);
      expect(Object.hasOwn(without, "score")).toBe(false);
      expect(Object.keys(without)).toEqual(["_id", "name"]);
    }
  });

  test("keys the schema does not know are kept as they came (a pass over the stored keys only when needed, A6)", async () => {
    const _id = new ObjectId();
    await t.mongo.db
      .collection("perf_events")
      .insertOne({ _id, name: "u", lines: [], tags: [], extra: 1, window: { from: new Date(T0), stray: "x" } });
    const doc = await load(_id);
    /* cast: reading a key outside the type */
    expect((doc as unknown as Record<string, unknown>).extra).toBe(1);
    /* cast: reading a key outside the type */
    expect((doc.window as unknown as Record<string, unknown>).stray).toBe("x");
  });
});

describe("access tracking only for arrays of objects longer than 50 elements", () => {
  /**
   * Whether the array's first element is an access-tracked accessor.
   * @param array The hydrated array.
   * @returns True when element 0 is defined by a getter.
   */
  const isAccessor = (array: readonly unknown[]): boolean =>
    Object.getOwnPropertyDescriptor(array, 0)?.get !== undefined;

  for (const [count, tracked] of [
    [49, false],
    [50, false],
    [51, true],
  ] as const) {
    test(`${count} elements: ${tracked ? "access tracking" : "direct comparison"}; every change is found`, async () => {
      const id = await seed(count);
      const doc = await load(id);
      expect(isAccessor(doc.lines)).toBe(tracked);
      expect(doc.$isModified()).toBe(false);
      const last = doc.lines[count - 1];
      if (last === undefined) throw new Error("no element");
      last.qty = 1000;
      const first = doc.lines.find((line) => line.sku === "s0");
      if (first !== undefined) first.sku = "changed";
      expect(doc.$getChanges()).toEqual({ $set: { "lines.0.sku": "changed", [`lines.${count - 1}.qty`]: 1000 } });
      await doc.$save();
      const after = await stored(id);
      expect(after?.lines[0].sku).toBe("changed");
      expect(after?.lines[count - 1].qty).toBe(1000);
      expect(doc.$isModified()).toBe(false);
      /* A reference kept across the save still writes through. */
      last.qty = 1001;
      expect(doc.$getChanges()).toEqual({ $set: { [`lines.${count - 1}.qty`]: 1001 } });
    });

    test(`${count} elements: a write around the methods is refused at save`, async () => {
      const doc = await load(await seed(count));
      const element = doc.lines[0];
      /* cast: bypasses the type to test the runtime guard — an index write on an array of objects */
      (doc.lines as unknown as unknown[])[1] = element;
      expect(doc.$getChanges().$problems?.lines).toBeString();
      await expect(doc.$save()).rejects.toThrow(DirectWriteError);
    });
  }

  test("51 elements: every way of reaching an element marks it (index, for…of, id(), map, spread)", async () => {
    const ways: readonly ((doc: HydratedDoc<PerfEvent>) => { qty: number } | undefined)[] = [
      (doc) => doc.lines[40],
      (doc) => {
        for (const line of doc.lines) if (line.sku === "s40") return line;
        return undefined;
      },
      (doc) => doc.lines.id(doc.lines.map((line) => line._id)[40] as ObjectId),
      (doc) => doc.lines.map((line) => line)[40],
      (doc) => [...doc.lines][40],
      (doc) => doc.lines.filter((line) => line.qty === 40)[0],
    ];
    const id = await seed(51);
    for (const way of ways) {
      const doc = await load(id);
      const line = way(doc);
      if (line === undefined) throw new Error("no element");
      line.qty = 4040;
      expect(doc.$getChanges()).toEqual({ $set: { "lines.40.qty": 4040 } });
    }
  });
});

describe("unknown keys — the count only for driver records, the exact check for Model.hydrate(raw)", () => {
  /**
   * A stored record where a schema field is a NON-enumerable own property and an unknown key is enumerable.
   * @returns The raw record.
   */
  const exotic = (): Record<string, unknown> => {
    const window: Record<string, unknown> = { stray: "x" };
    Object.defineProperty(window, "from", { value: new Date(T0), enumerable: false });
    const raw: Record<string, unknown> = { _id: new ObjectId(), lines: [], tags: [], window, extra: 1 };
    Object.defineProperty(raw, "name", { value: "hidden-key", enumerable: false });
    return raw;
  };

  test("Model.hydrate: a non-enumerable schema field does not hide an unknown key (root and nested object)", () => {
    const doc = Events.hydrate(exotic());
    expect(doc.name).toBe("hidden-key");
    expect(doc.window?.from?.getTime()).toBe(T0);
    /* cast: reading a key outside the type */
    expect((doc as unknown as Record<string, unknown>).extra).toBe(1);
    /* cast: reading a key outside the type */
    expect((doc.window as unknown as Record<string, unknown>).stray).toBe("x");
  });

  test("Model.hydrate: an ordinary record — unknown keys kept, known ones hydrated, no key invented", () => {
    const _id = new ObjectId();
    const doc = Events.hydrate({ _id, name: "n", lines: [{ _id, sku: "a", qty: 1, odd: true }], tags: [], extra: 2 });
    expect(Object.keys(doc)).toEqual(["_id", "name", "lines", "tags", "extra"]);
    expect(Object.keys(doc.lines[0] ?? {})).toEqual(["_id", "sku", "qty", "odd"]);
  });

  test("a driver read keeps unknown keys at every depth (the count path)", async () => {
    const _id = new ObjectId();
    await t.mongo.db.collection("perf_events").insertOne({
      _id,
      name: "d",
      lines: [{ _id: new ObjectId(), sku: "a", qty: 1, odd: true }],
      tags: [],
      extra: 3,
    });
    const doc = await load(_id);
    /* cast: reading a key outside the type */
    expect((doc as unknown as Record<string, unknown>).extra).toBe(3);
    /* cast: reading a key outside the type */
    expect((doc.lines[0] as unknown as Record<string, unknown>).odd).toBe(true);
  });
});

describe("an array that grows past 50 elements switches to access tracking at once", () => {
  /**
   * Whether the array's first element is an access-tracked accessor.
   * @param array The hydrated array.
   * @returns True when element 0 is defined by a getter.
   */
  const isAccessor = (array: readonly unknown[]): boolean =>
    Object.getOwnPropertyDescriptor(array, 0)?.get !== undefined;
  /**
   * The update document of the one `update` command the last save sent.
   * @returns The `u` part of the single update.
   */
  const sentUpdate = (): Record<string, unknown> => {
    const updates = t.commands.byName("update");
    expect(updates.length).toBe(1);
    return updates[0]?.command.updates[0].u as Record<string, unknown>;
  };
  /**
   * Saves a document and returns the update it sent.
   * @param doc The hydrated event.
   * @returns The `u` part of the single update.
   */
  const save = async (doc: HydratedDoc<PerfEvent>): Promise<Record<string, unknown>> => {
    t.commands.clear();
    await doc.$save();
    return sentUpdate();
  };
  /**
   * A raw line without an id.
   * @param sku The line sku.
   * @param qty The quantity.
   * @returns The line input.
   */
  const line = (sku: string, qty: number) => ({ sku, qty, at: new Date(T0) });

  test("49 → 50 stays direct comparison, 50 → 51 switches; the switch happens in push, unshift, addToSet, splice, replace", async () => {
    const grow: readonly ((doc: HydratedDoc<PerfEvent>) => void)[] = [
      (doc) => doc.lines.push(line("n", 1)),
      (doc) => doc.lines.unshift(line("n", 1)),
      (doc) => doc.lines.addToSet(line("n", 1)),
      (doc) => doc.lines.splice(3, 0, line("n", 1)),
      (doc) => doc.lines.replace([...doc.lines, line("n", 1)]),
    ];
    const id = await seed(49);
    for (const way of grow) {
      const doc = await load(id);
      way(doc);
      expect(doc.lines.length).toBe(50);
      expect(isAccessor(doc.lines)).toBe(false);
      way(doc);
      expect(doc.lines.length).toBe(51);
      expect(isAccessor(doc.lines)).toBe(true);
    }
  });

  test("an element taken before the switch and changed after it, a new element, a removal: exact updates and state", async () => {
    const id = await seed(50);
    const doc = await load(id);
    const old = doc.lines[3];
    if (old === undefined) throw new Error("no element");
    doc.lines.push(line("new", 50));
    expect(isAccessor(doc.lines)).toBe(true);
    const pushed = await save(doc);
    expect(Object.keys(pushed)).toEqual(["$push"]);
    expect((pushed.$push as { lines: { $each: { sku: string }[] } }).lines.$each.map((item) => item.sku)).toEqual([
      "new",
    ]);
    expect((await stored(id))?.lines.length).toBe(51);

    /* The reference was taken while the array was short (never marked by a read): still found. */
    old.qty = 7;
    expect(await save(doc)).toEqual({ $set: { "lines.3.qty": 7 } });
    expect((await stored(id))?.lines[3].qty).toBe(7);

    const added = doc.lines[50];
    if (added === undefined) throw new Error("no element");
    added.qty = 8;
    expect(await save(doc)).toEqual({ $set: { "lines.50.qty": 8 } });
    expect((await stored(id))?.lines[50].qty).toBe(8);

    const first = doc.lines[0];
    if (first === undefined) throw new Error("no element");
    doc.lines.pull(first);
    expect(await save(doc)).toEqual({ $pull: { lines: { _id: { $in: [first._id] } } } });
    const after = await stored(id);
    expect(after?.lines.length).toBe(50);
    expect(after?.lines[0].sku).toBe("s1");
    expect(after?.lines[2].qty).toBe(7);
    expect(doc.$isModified()).toBe(false);
  });

  test("an element changed while the array was short, then the switch: the change is saved (whole array with the push)", async () => {
    const id = await seed(50);
    const doc = await load(id);
    const old = doc.lines[10];
    if (old === undefined) throw new Error("no element");
    old.qty = 1010;
    doc.lines.push(line("new", 50));
    /* A push plus a change inside an element touch the same path (code 40): the array goes whole. */
    const sent = await save(doc);
    expect(Object.keys(sent)).toEqual(["$set"]);
    const after = await stored(id);
    expect(after?.lines.length).toBe(51);
    expect(after?.lines[10].qty).toBe(1010);
    expect(after?.lines[50].sku).toBe("new");
  });

  test("after the switch and a save: a pop and a change inside an element go as one whole-array $set", async () => {
    const id = await seed(50);
    const doc = await load(id);
    doc.lines.push(line("new", 50));
    await save(doc);
    /* A $pop plus a change inside an element touch the same path: the array is written whole. */
    const kept = doc.lines.find((item) => item.sku === "s20");
    if (kept === undefined) throw new Error("no element");
    doc.lines.pop();
    kept.qty = 2020;
    const sent = await save(doc);
    expect(sent).toEqual({ $set: { lines: expect.any(Array) } });
    const after = await stored(id);
    expect(after?.lines.length).toBe(50);
    expect(after?.lines[20].qty).toBe(2020);
  });

  test("a write around the methods before the switch is still refused at save", async () => {
    const doc = await load(await seed(50));
    const element = doc.lines[0];
    /* cast: bypasses the type to test the runtime guard — an index write on an array of objects */
    (doc.lines as unknown as unknown[])[1] = element;
    doc.lines.push(line("new", 50));
    expect(isAccessor(doc.lines)).toBe(true);
    expect(doc.$getChanges().$problems?.lines).toBeString();
    await expect(doc.$save()).rejects.toThrow(DirectWriteError);
  });
});

describe("a stored key under the code name of a renamed field is not put on the document", () => {
  /**
   * The raw collection of the renamed-field entity.
   * @returns The driver collection.
   */
  const renamed = () => t.mongo.db.collection("perf_renamed");
  /**
   * Loads a renamed-field document through the model.
   * @param id The document id.
   * @returns The hydrated document.
   */
  const loadRenamed = async (id: ObjectId) => await t.connection.model(PerfRenamed).findById(id).orFail();
  /**
   * Whether a value has an own property.
   * @param value The object to check.
   * @param key The property name.
   * @returns True when the property is an own one.
   */
  const own = (value: unknown, key: string): boolean => Object.hasOwn(value as object, key);

  test("root: legacy `name` alone, and next to the stored `n` — not modified, no change, save sends nothing", async () => {
    const alone = new ObjectId();
    const both = new ObjectId();
    await renamed().insertMany([
      /* `items: []` stored: an absent array would get its default `[]`, a change of its own. */
      { _id: alone, name: "legacy", qty: 1, items: [] },
      { _id: both, n: "new", name: "legacy", qty: 1, items: [] },
    ]);
    const first = await loadRenamed(alone);
    expect(first.name).toBeUndefined();
    expect(own(first, "name")).toBe(false);
    expect(first.$isModified()).toBe(false);
    expect(first.$getChanges()).toEqual({});
    const second = await loadRenamed(both);
    expect(second.name).toBe("new"); /* the stored `n`, never overwritten by the legacy key */
    expect(second.$isModified()).toBe(false);
    expect(second.$getChanges()).toEqual({});
    t.commands.clear();
    await first.$save();
    await second.$save();
    expect(t.commands.byName("update")).toEqual([]);
    /* A real change is saved alone; the legacy key stays in the database as it was. */
    second.qty = 2;
    await second.$save();
    expect(await renamed().findOne({ _id: both })).toEqual({ _id: both, n: "new", name: "legacy", qty: 2, items: [] });
  });

  test("subdocuments (nested object, array element): legacy keys are not put on them, nothing is modified", async () => {
    const id = new ObjectId();
    const item = new ObjectId();
    await renamed().insertOne({
      _id: id,
      n: "doc",
      info: { city: "legacy" },
      items: [{ _id: item, l: "new", label: "legacy", qty: 1 }],
    });
    const doc = await loadRenamed(id);
    expect(doc.info?.city).toBeUndefined();
    expect(own(doc.info, "city")).toBe(false);
    expect(doc.items?.[0]?.label).toBe("new");
    expect(doc.$isModified()).toBe(false);
    expect(doc.$getChanges()).toEqual({});
    t.commands.clear();
    await doc.$save();
    expect(t.commands.byName("update")).toEqual([]);
    const element = doc.items?.[0];
    if (element !== undefined) element.qty = 2;
    expect(doc.$getChanges()).toEqual({ $set: { "items.0.qty": 2 } });
    await doc.$save();
    expect((await renamed().findOne({ _id: id }))?.items).toEqual([{ _id: item, l: "new", label: "legacy", qty: 2 }]);
  });

  test("Model.hydrate (the exact path): the same at the root and in subdocuments", () => {
    const doc = t.connection.model(PerfRenamed).hydrate({
      _id: new ObjectId(),
      name: "legacy",
      info: { city: "legacy" },
      items: [{ _id: new ObjectId(), label: "legacy" }],
    });
    expect(own(doc, "name")).toBe(false);
    expect(own(doc.info, "city")).toBe(false);
    expect(own(doc.items?.[0], "label")).toBe(false);
    expect(doc.$isModified()).toBe(false);
    expect(doc.$getChanges()).toEqual({});
  });
});

describe("an array's journal is created only by a change", () => {
  /**
   * The journal an array would hand to a write now (`undefined`: it never had one). Test-only protocol access.
   * @param array The tracked array.
   * @returns The journal, or undefined.
   */
  const journalOf = (array: unknown): unknown => (array as { [MARK](): { journal: unknown } })[MARK]().journal;

  test("$getChanges and a save of other fields create no journal on unchanged arrays", async () => {
    const doc = await load(await seed(3));
    expect(doc.$getChanges()).toEqual({});
    doc.name = "renamed";
    expect(doc.$getChanges()).toEqual({ $set: { name: "renamed" } });
    await doc.$save();
    expect(journalOf(doc.lines)).toBeUndefined();
    expect(journalOf(doc.tags)).toBeUndefined();
    /* A change still creates it, and it is sent. */
    doc.tags.push("c");
    expect(journalOf(doc.tags)).toBeDefined();
  });
});

describe("Model.hydrate reads schema fields from the record's own properties only", () => {
  test("a field on the record's prototype is not read; a getter there is never invoked", () => {
    const inherited = Events.hydrate(Object.create({ name: "proto", qty: 42 }) as Record<string, unknown>);
    expect(inherited.name).toBeUndefined();
    expect(Object.hasOwn(inherited, "name")).toBe(false);
    let calls = 0;
    const proto = Object.defineProperty({}, "name", {
      get: () => {
        calls++;
        return "from-getter";
      },
      enumerable: true,
    });
    const record = Object.create(proto) as Record<string, unknown>;
    record._id = new ObjectId();
    /* The arrays stored: an absent array would get its default `[]`, a change of its own. */
    record.lines = [];
    record.tags = [];
    const doc = Events.hydrate(record);
    expect(calls).toBe(0);
    expect(Object.hasOwn(doc, "name")).toBe(false);
    expect(doc.$isModified()).toBe(false);
  });
});
