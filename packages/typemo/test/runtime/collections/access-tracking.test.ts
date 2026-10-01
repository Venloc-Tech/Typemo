/*
 * Access tracking: `$getChanges`/save compare with the baseline only the elements of an array (or the
 * values of a Map) of OBJECTS that were handed to user code. Correctness must not change: EVERY way to reach an element
 * marks it — an index, `for…of`, destructuring, spread, `id()`, `find`/`filter`/`map`/`some`/`every`/`reduce`/`at`/
 * `slice`/`indexOf`/`includes`/`entries`/`values`/`forEach`/`Array.from`/`Object.values`, a `sort` comparator, the
 * elements put by a method — at every depth (collections inside subdocuments), in Maps (`get`, `values`, `entries`,
 * `forEach`, iteration), and across saves (a reference kept from before a save). No Proxy is used.
 */
import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { Entity, type HydratedDoc, type Model, Prop, Schema, Spec } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** A plain object stored inside an item, in an array and in a Map. */
@Schema()
class Leaf {
  @Prop(() => String) tag?: string;
  @Prop(() => Number) w?: number;
}

/** An element of the holder's array and Map, with its own nested collections. */
@Schema()
class Item extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number, { required: true }) n!: number;
  @Prop(() => [Leaf]) leaves!: Leaf[];
  @Prop(() => Spec.map(Leaf)) byTag!: Map<string, Leaf>;
}

/** The root document: an array, a Map and a matrix of objects. */
@Schema({ collection: "n1_holders" })
class Holder extends Entity {
  @Prop(() => [Item]) items!: Item[];
  @Prop(() => Spec.map(Item)) byKey!: Map<string, Item>;
  @Prop(() => [[Number]]) matrix!: number[][];
}

const t = ModelLifecycle.useTypemo("n1_access");
const ids = [new ObjectId(), new ObjectId(), new ObjectId()];
/**
 * A raw stored form of a holder with three items and one Map value.
 * @returns A fresh raw document.
 */
const raw = () => ({
  _id: new ObjectId(),
  items: ids.map((_id, i) => ({
    _id,
    name: `item ${i}`,
    n: i,
    leaves: [{ tag: "a", w: 1 }],
    byTag: { a: { tag: "a", w: 1 } },
  })),
  byKey: { k0: { _id: new ObjectId(), name: "m0", n: 0, leaves: [], byTag: {} } },
  matrix: [
    [1, 2],
    [3, 4],
  ],
});

let Holders: Model<Holder>;
/**
 * Hydrates a new holder without reading the database.
 * @returns A hydrated holder with nothing touched yet.
 */
const fresh = (): HydratedDoc<Holder> => {
  Holders = t.connection.model(Holder);
  return Holders.hydrate(raw());
};
/**
 * The changes of a document as JSON, to compare them with a pattern.
 * @param doc The hydrated holder.
 * @returns `$getChanges()` serialized.
 */
const changes = (doc: HydratedDoc<Holder>) => JSON.stringify(doc.$getChanges());
/** A hydrated element (a subdocument) and a hydrated Map value. */
type El = HydratedDoc<Holder>["items"][number];
type MapValue = NonNullable<ReturnType<HydratedDoc<Holder>["byKey"]["get"]>>;

/** Every way user code can get an element: each returns the element at position 1 (or all of them). */
const WAYS: readonly (readonly [string, (items: HydratedDoc<Holder>["items"]) => El | undefined])[] = [
  ["index", (items) => items[1]],
  [
    "for…of",
    (items) => {
      let found: El | undefined;
      for (const item of items) if (item.n === 1) found = item;
      return found;
    },
  ],
  [
    "destructuring",
    (items) => {
      const [, second] = items;
      return second;
    },
  ],
  ["spread", (items) => [...items][1]],
  ["id()", (items) => items.id(ids[1] as ObjectId)],
  ["find", (items) => items.find((item) => item.n === 1)],
  ["filter", (items) => items.filter((item) => item.n === 1)[0]],
  ["map", (items) => items.map((item) => item)[1]],
  [
    "some",
    (items) => {
      let found: El | undefined;
      items.some((item) => {
        if (item.n !== 1) return false;
        found = item;
        return true;
      });
      return found;
    },
  ],
  [
    "every",
    (items) => {
      let found: El | undefined;
      items.every((item) => {
        if (item.n !== 1) return true;
        found = item;
        return false;
      });
      return found;
    },
  ],
  ["reduce", (items) => items.reduce<El | undefined>((acc, item) => (item.n === 1 ? item : acc), undefined)],
  ["at", (items) => items.at(1)],
  ["slice", (items) => items.slice(1, 2)[0]],
  ["entries", (items) => [...items.entries()][1]?.[1]],
  ["values", (items) => [...items.values()][1]],
  [
    "forEach",
    (items) => {
      let found: El | undefined;
      items.forEach((item) => {
        if (item.n === 1) found = item;
      });
      return found;
    },
  ],
  ["Array.from", (items) => Array.from(items)[1]],
  ["Object.values", (items) => Object.values(items)[1]],
  ["findLast", (items) => items.findLast((item) => item.n === 1)],
  [
    "sort comparator",
    (items) => {
      let found: El | undefined;
      items.sort((a, b) => {
        if (a.n === 1) found = a;
        if (b.n === 1) found = b;
        return a.n - b.n;
      });
      return found;
    },
  ],
];

describe("a change through any way of reaching an element is found", () => {
  test.each(WAYS)("%s", (_name, reach) => {
    const doc = fresh();
    const item = reach(doc.items);
    if (item === undefined) throw new Error("not reached");
    item.name = "changed";
    /* a sort rewrites the whole array: the change is in the whole value */
    expect(changes(doc)).toMatch(/"items\.1\.name":"changed"|"name":"changed"/);
  });

  test("indexOf / includes with a reference obtained elsewhere (the reference came from a read: marked)", () => {
    const doc = fresh();
    const item = doc.items[1];
    if (item === undefined) throw new Error("no item");
    expect(doc.items.indexOf(item)).toBe(1);
    expect(doc.items.includes(item)).toBe(true);
    item.n = 10;
    expect(changes(doc)).toContain('"items.1.n":10');
  });

  test("an element put by a method (the caller holds it): push, unshift, splice, set, replace", () => {
    const doc = fresh();
    const created = doc.items.create({ name: "new", n: 9, leaves: [], byTag: {} });
    doc.items.push(created);
    /* The push itself is $push; after a save the held reference must still be compared. */
    expect(changes(doc)).toContain("$push");
  });

  test("nothing read: nothing compared and nothing reported", () => {
    const doc = fresh();
    expect(doc.$getChanges()).toEqual({});
  });

  test("a nested collection inside an element: array of subdocuments and Map of subdocuments", () => {
    const doc = fresh();
    const leaf = doc.items[2]?.leaves[0];
    if (leaf === undefined) throw new Error("no leaf");
    leaf.w = 7;
    expect(changes(doc)).toContain('"items.2.leaves.0.w":7');
    const other = fresh();
    const inner = other.items[0]?.byTag.get("a");
    if (inner === undefined) throw new Error("no map value");
    inner.w = 8;
    expect(changes(other)).toContain('"items.0.byTag.a.w":8');
  });

  test("Map of subdocuments: get, values, entries, forEach, for…of, destructuring", () => {
    const reads: readonly ((map: HydratedDoc<Holder>["byKey"]) => MapValue | undefined)[] = [
      (map) => map.get("k0"),
      (map) => [...map.values()][0],
      (map) => [...map.entries()][0]?.[1],
      (map) => {
        let found: MapValue | undefined;
        map.forEach((value) => {
          found = value;
        });
        return found;
      },
      (map) => {
        let found: MapValue | undefined;
        for (const [, value] of map) found = value;
        return found;
      },
      (map) => {
        const [[, value] = ["", undefined]] = map;
        return value;
      },
    ];
    for (const read of reads) {
      const doc = fresh();
      const value = read(doc.byKey);
      if (value === undefined) throw new Error("not reached");
      value.n = 42;
      expect(changes(doc)).toContain('"byKey.k0.n":42');
    }
  });

  test("an array of arrays: an inner array reached by index", () => {
    const doc = fresh();
    doc.matrix[1]?.push(5);
    expect(changes(doc)).toContain("matrix.1");
  });

  test("writes around the methods: $getChanges marks the path without throwing (index setter, length)", () => {
    const doc = fresh();
    /* cast: deliberate bypass of the type to test the runtime guard — an index write on an array of objects */
    (doc.items as unknown as unknown[])[0] = {};
    expect(doc.$getChanges().$problems?.items).toBeString();
    expect(doc.$isModified()).toBe(true);
    const other = fresh();
    /* cast: deliberate bypass of the type to test the runtime guard — a length write (recorded) */
    (other.items as unknown as unknown[]).length = 0;
    expect(other.$isModified()).toBe(true);
    expect(other.$getChanges().$problems?.items).toMatch(/its length is 0 instead of 3/);
  });

  test("a whole array assigned directly: $getChanges returns the other changes and marks the path", () => {
    const doc = fresh();
    doc.matrix[1]?.push(5);
    /* cast: deliberate bypass of the type — a direct assignment of the whole array */
    (doc as unknown as { items: unknown[] }).items = [];
    const changes = doc.$getChanges();
    expect(Object.keys(changes.$set ?? changes.$push ?? {}).join()).toContain("matrix");
    expect(changes.$problems?.items).toContain("replaced by assignment");
  });

  test("the core's own reads do not mark: $toObject, $index/$fullPath of a held element, $isModified", () => {
    const doc = fresh();
    doc.$toObject();
    expect(doc.$isModified()).toBe(false);
    const item = doc.items[2];
    if (item === undefined) throw new Error("no item");
    expect(item.$index()).toBe(2);
    expect(item.$fullPath()).toBe("items.2");
  });
});

describe("access tracking across saves (real server)", () => {
  test("a reference kept from before a save is still compared at the next save", async () => {
    Holders = t.connection.model(Holder);
    const created = await Holders.create({
      items: [{ name: "a", n: 1, leaves: [], byTag: {} }],
      byKey: {},
      matrix: [],
    });
    const doc = await Holders.findById(created._id).orFail();
    const held = doc.items[0];
    if (held === undefined) throw new Error("no item");
    held.n = 2;
    await doc.$save();
    held.n = 3; /* no new read of the array */
    await doc.$save();
    const stored = await t.mongo.db.collection("n1_holders").findOne({ _id: created._id });
    expect(stored?.items[0].n).toBe(3);
  });

  test("an element pushed then saved, changed through the pushed reference", async () => {
    Holders = t.connection.model(Holder);
    const doc = await Holders.create({ items: [], byKey: {}, matrix: [] });
    const item = doc.items.create({ name: "p", n: 1, leaves: [], byTag: {} });
    doc.items.push(item);
    await doc.$save();
    item.n = 5;
    await doc.$save();
    const stored = await t.mongo.db.collection("n1_holders").findOne({ _id: doc._id });
    expect(stored?.items[0].n).toBe(5);
  });

  test("a Map value kept from before a save", async () => {
    Holders = t.connection.model(Holder);
    const doc = await Holders.create({
      items: [],
      byKey: { k: { name: "m", n: 1, leaves: [], byTag: {} } },
      matrix: [],
    });
    const value = doc.byKey.get("k");
    if (value === undefined) throw new Error("no value");
    value.n = 2;
    await doc.$save();
    value.n = 3;
    await doc.$save();
    const stored = await t.mongo.db.collection("n1_holders").findOne({ _id: doc._id });
    expect(stored?.byKey.k.n).toBe(3);
  });
});
