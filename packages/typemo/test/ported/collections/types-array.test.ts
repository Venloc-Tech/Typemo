/*
 * Ported from mongoose test/types.array.test.js. The Mongoose flow `new M() → save() →
 * findById()` runs through the Typemo model (`create`) and the tracked fields (`PortedDocs`).
 * Differences of the strict variant are marked `divergence` with the reason.
 */
import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import {
  CastError,
  Collections,
  Entity,
  Prop,
  Schema,
  SchemaCompiler,
  type StrictArray,
} from "../../../src/internal.ts";
import { PortedDocs } from "../../fixtures/collections/ported-docs.ts";
import { TrackedRoot } from "../../fixtures/collections/tracked-root.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("p_types_array");

@Schema()
class Kind {
  @Prop(() => String) type?: string;
}

@Schema({ collection: "pa_numbers" })
class Numbers extends Entity {
  @Prop(() => [Number]) arr!: number[];
}

@Schema({ collection: "pa_strings" })
class Strings extends Entity {
  @Prop(() => [String]) arr!: string[];
}

@Schema({ collection: "pa_kinds" })
class Kinds extends Entity {
  @Prop(() => [Kind]) types!: Kind[];
  @Prop(() => [Number]) nums!: number[];
  @Prop(() => [String]) strs!: string[];
}

@Schema({ collection: "pa_refs" })
class Refs extends Entity {
  @Prop(() => [ObjectId]) a!: ObjectId[];
}

@Schema()
class Member {
  @Prop(() => String) name?: string;
  @Prop(() => String) role?: string;
}

@Schema({ collection: "pa_bands" })
class Band extends Entity {
  @Prop(() => String) name?: string;
  @Prop(() => [Member]) members!: Member[];
}

@Schema()
class User {
  @Prop(() => String) username?: string;
}

@Schema({ collection: "pa_users" })
class Users extends Entity {
  @Prop(() => [User]) em!: User[];
}

@Schema()
class WithSub extends Entity {
  @Prop(() => [String]) sub!: string[];
}

@Schema({ collection: "pa_subs" })
class Subs extends Entity {
  @Prop(() => [WithSub]) em!: WithSub[];
}

@Schema()
class StringId {
  @Prop(() => String) _id!: string;
  @Prop(() => String) other?: string;
}

@Schema({ collection: "pa_string_ids" })
class StringIds extends Entity {
  @Prop(() => [StringId]) subs!: StringId[];
}

@Schema({ collection: "pa_matrix" })
class Matrix extends Entity {
  @Prop(() => [[Number]]) intArr!: number[][];
  @Prop(() => [[String]]) arr?: string[][];
}

const kinds = () => ({
  types: [{ type: "bird" }, { type: "boy" }, { type: "frog" }, { type: "cloud" }],
  nums: [1, 2, 3],
  strs: "one two three".split(" "),
});

describe("types array", () => {
  // ported from mongoose test/types.array.test.js:45 "behaves and quacks like an Array"
  test("behaves and quacks like an Array", async () => {
    const doc = await PortedDocs.create(t, Numbers, { arr: [] });
    const a = doc.doc.arr;
    // biome-ignore lint/suspicious/useIsArray: ported assertion — the value is an Array instance, not only array-like
    expect(a instanceof Array).toBe(true);
    expect(Array.isArray(a)).toBe(true);
    expect(Collections.isTracked(a)).toBe(true);
  });

  // ported from mongoose test/types.array.test.js:56 "is `deepEqual()` another array (gh-7700)"
  test("is `deepEqual()` another array (gh-7700)", async () => {
    const doc = await PortedDocs.create(t, Strings, { arr: ["test"] });
    expect([...doc.doc.arr]).toEqual(["test"]);
    expect(doc.doc.arr).toEqual(["test"] as never);
  });

  describe("push()", () => {
    // ported from mongoose test/types.array.test.js:151 "works with numbers"
    test("works with numbers", async () => {
      let doc = await PortedDocs.create(t, Numbers, { arr: [3, 4, 5, 6] });
      expect(doc.doc.arr.length).toBe(4);
      doc.doc.arr.push(8);
      expect(doc.doc.arr[doc.doc.arr.length - 1]).toBe(8);
      expect(doc.doc.arr[4]).toBe(8);
      doc = await PortedDocs.saveAndFind(t, Numbers, doc);
      expect([...doc.doc.arr]).toEqual([3, 4, 5, 6, 8]);
    });

    // ported from mongoose test/types.array.test.js:169 "works with strings"
    // divergence (strict cast, from-mongoose-to-typemo/DIVERGENCES.md L1-1): the number 8 is not cast to "8";
    // a string is pushed.
    test("works with strings", async () => {
      let doc = await PortedDocs.create(t, Strings, { arr: ["3", "4", "5", "6"] });
      expect(doc.doc.arr.length).toBe(4);
      doc.doc.arr.push("8");
      expect(doc.doc.arr[4]).toBe("8");
      /* cast: bypasses the type to test the runtime guard — a value of the wrong type pushed (JS caller) */
      expect(() => (doc.doc.arr as unknown as { push(v: unknown): number }).push(8)).toThrow(CastError);
      doc = await PortedDocs.saveAndFind(t, Strings, doc);
      expect([...doc.doc.arr]).toEqual(["3", "4", "5", "6", "8"]);
    });
  });

  describe("splice()", () => {
    // ported from mongoose test/types.array.test.js:288 "works"
    // divergence (strict cast): the replacement is the number 10, not the string '10'.
    test("works", async () => {
      let doc = await PortedDocs.create(t, Numbers, { arr: [4, 5, 6, 7] });
      const removed = doc.doc.arr.splice(1, 1, 10);
      expect(removed).toEqual([5]);
      expect(typeof doc.doc.arr[1]).toBe("number");
      expect(doc.doc.arr.$toObject()).toEqual([4, 10, 6, 7]);
      doc = await PortedDocs.saveAndFind(t, Numbers, doc);
      expect(doc.doc.arr.$toObject()).toEqual([4, 10, 6, 7]);
    });

    // ported from mongoose test/types.array.test.js:304 "on embedded docs"
    test("on embedded docs", async () => {
      let doc = await PortedDocs.create(t, Kinds, { ...kinds(), nums: [], strs: [] });
      doc.doc.types.pop();
      const removed = doc.doc.types.splice(1, 1);
      expect(removed.length).toBe(1);
      expect(removed[0]?.type).toBe("boy");
      let obj = doc.doc.types.$toObject();
      expect(obj[0]?.type).toBe("bird");
      expect(obj[1]?.type).toBe("frog");
      doc = await PortedDocs.saveAndFind(t, Kinds, doc);
      obj = doc.doc.types.$toObject();
      expect(obj.map((kind) => kind.type)).toEqual(["bird", "frog"]);
    });
  });

  describe("unshift()", () => {
    // ported from mongoose test/types.array.test.js:332 "works"
    test("works", async () => {
      let doc = await PortedDocs.create(t, Kinds, kinds());
      expect(doc.doc.types.unshift({ type: "tree" })).toBe(5);
      expect(doc.doc.nums.unshift(0)).toBe(4);
      expect(doc.doc.strs.unshift("zero")).toBe(4);
      doc.doc.types.push({ type: "worm" });
      const expected = ["tree", "bird", "boy", "frog", "cloud", "worm"];
      expect(doc.doc.types.$toObject().map((kind) => kind.type)).toEqual(expected);
      expect(doc.doc.nums.$toObject()).toEqual([0, 1, 2, 3]);
      expect(doc.doc.strs.$toObject()).toEqual(["zero", "one", "two", "three"]);
      doc = await PortedDocs.saveAndFind(t, Kinds, doc);
      expect(doc.doc.types.$toObject().map((kind) => kind.type)).toEqual(expected);
      expect(doc.doc.nums.$toObject()).toEqual([0, 1, 2, 3]);
      expect(doc.doc.strs.$toObject()).toEqual(["zero", "one", "two", "three"]);
    });
  });

  describe("shift()", () => {
    // ported from mongoose test/types.array.test.js:429 "works"
    test("works", async () => {
      let doc = await PortedDocs.create(t, Kinds, kinds());
      expect(doc.doc.types.shift()?.type).toBe("bird");
      expect(doc.doc.nums.shift()).toBe(1);
      expect(doc.doc.strs.shift()).toBe("one");
      expect(doc.doc.types.$toObject().map((kind) => kind.type)).toEqual(["boy", "frog", "cloud"]);
      doc.doc.nums.push(4);
      expect(doc.doc.nums.$toObject()).toEqual([2, 3, 4]);
      expect(doc.doc.strs.$toObject()).toEqual(["two", "three"]);
      doc = await PortedDocs.saveAndFind(t, Kinds, doc);
      expect(doc.doc.types.$toObject().map((kind) => kind.type)).toEqual(["boy", "frog", "cloud"]);
      expect(doc.doc.nums.$toObject()).toEqual([2, 3, 4]);
      expect(doc.doc.strs.$toObject()).toEqual(["two", "three"]);
    });
  });

  describe("pop()", () => {
    // ported from mongoose test/types.array.test.js:520 "works"
    test("works", async () => {
      let doc = await PortedDocs.create(t, Kinds, kinds());
      expect(doc.doc.types.pop()?.type).toBe("cloud");
      expect(doc.doc.nums.pop()).toBe(3);
      expect(doc.doc.strs.pop()).toBe("three");
      doc.doc.nums.push(4);
      doc = await PortedDocs.saveAndFind(t, Kinds, doc);
      expect(doc.doc.types.$toObject().map((kind) => kind.type)).toEqual(["bird", "boy", "frog"]);
      expect(doc.doc.nums.$toObject()).toEqual([1, 2, 4]);
      expect(doc.doc.strs.$toObject()).toEqual(["one", "two"]);
    });
  });

  describe("pull()", () => {
    // ported from mongoose test/types.array.test.js:582 "works"
    test("works", async () => {
      const cat = new ObjectId();
      const doc = await PortedDocs.create(t, Refs, { a: [cat] });
      expect(doc.doc.a.length).toBe(1);
      doc.doc.a.pull(new ObjectId(cat.toHexString()));
      expect(doc.doc.a.length).toBe(0);
      expect(doc.ops().$pullAll?.a).toBeDefined();
    });

    // ported from mongoose test/types.array.test.js:603 "registers $pull atomic if pulling from middle (gh-14502)"
    test("registers $pull atomic if pulling from middle (gh-14502)", async () => {
      const [oid1, oid2, oid3] = [new ObjectId(), new ObjectId(), new ObjectId()];
      const doc = await PortedDocs.create(t, Refs, { a: [oid1, oid2, oid3] });
      doc.doc.a.pull(oid2);
      expect(doc.doc.a.length).toBe(2);
      expect(doc.ops().$pullAll?.a).toEqual([oid2]);
    });

    // ported from mongoose test/types.array.test.js:623 "handles pulling with no _id (gh-3341)"
    // divergence: pull() of a subdocument array takes subdocuments or ids, not a condition object; the
    // element is found first. Without `_id` the array is written whole ($set), as no $pull names it.
    test("handles pulling with no _id (gh-3341)", async () => {
      let gnr = await PortedDocs.create(t, Band, {
        name: "Guns N' Roses",
        members: [
          { name: "Axl", role: "Lead Singer" },
          { name: "Slash", role: "Guitar" },
          { name: "Izzy", role: "Guitar" },
          { name: "Duff", role: "Bass" },
          { name: "Adler", role: "Drums" },
        ],
      });
      const slash = gnr.doc.members.find((member) => member.name === "Slash" && member.role === "Guitar");
      if (slash !== undefined) gnr.doc.members.pull(slash);
      expect(gnr.doc.members.map((member) => member.name)).toEqual(["Axl", "Izzy", "Duff", "Adler"]);
      gnr = await PortedDocs.saveAndFind(t, Band, gnr);
      expect(gnr.doc.members.map((member) => member.name)).toEqual(["Axl", "Izzy", "Duff", "Adler"]);
    });
  });

  describe("$pop()", () => {
    // ported from mongoose test/types.array.test.js:738 "works"
    // divergence: Mongoose's `$pop()` is a silent no-op the second time before a save; Typemo's pop()
    // always removes, and a second pop in one save writes the whole array. The saved result is the same.
    test("works", async () => {
      let doc = await PortedDocs.create(t, Strings, { arr: ["blue", "green", "yellow"] });
      expect(doc.doc.arr.pop()).toBe("yellow");
      expect(doc.ops()).toEqual({ $pop: { arr: 1 } });
      doc = await PortedDocs.saveAndFind(t, Strings, doc);
      expect(doc.doc.arr.pop()).toBe("green");
      doc = await PortedDocs.saveAndFind(t, Strings, doc);
      expect([...doc.doc.arr]).toEqual(["blue"]);
    });
  });

  describe("addToSet()", () => {
    // ported from mongoose test/types.array.test.js:766 "works" (the part with values of each kind)
    test("works", async () => {
      const [id1, id2, id3] = [new ObjectId(), new ObjectId(), new ObjectId()];
      const doc = await PortedDocs.create(t, Refs, { a: [id1, id2] });
      doc.doc.a.addToSet(new ObjectId(id1.toHexString()), id3, id3);
      expect(doc.doc.a.length).toBe(3);
      expect(doc.ops()).toEqual({ $addToSet: { a: { $each: [id3] } } });
      const nums = await PortedDocs.create(t, Numbers, { arr: [1, 2, 3] });
      nums.doc.arr.addToSet(3, 4, 5);
      expect([...nums.doc.arr]).toEqual([1, 2, 3, 4, 5]);
    });

    // ported from mongoose test/types.array.test.js:989 "handles sub-documents that do not have an _id gh-1973"
    test("handles sub-documents that do not have an _id gh-1973", async () => {
      let band = await PortedDocs.create(t, Band, { members: [] });
      band.doc.members.addToSet({ name: "Rap" });
      band = await PortedDocs.saveAndFind(t, Band, band);
      expect(band.doc.members.length).toBe(1);
      expect(band.doc.members[0]?.name).toBe("Rap");
      band.doc.members.addToSet({ name: "House" }, { name: "Rap" });
      expect(band.doc.members.length).toBe(2);
      band = await PortedDocs.saveAndFind(t, Band, band);
      expect(band.doc.members.map((member) => member.name)).toEqual(["Rap", "House"]);
    });
  });

  describe("sort()", () => {
    // ported from mongoose test/types.array.test.js:1138 "order should be saved"
    test("order should be saved", async () => {
      let m = await PortedDocs.create(t, Numbers, { arr: [1, 4, 3, 2] });
      m.doc.arr.sort();
      m = await PortedDocs.saveAndFind(t, Numbers, m);
      expect([...m.doc.arr]).toEqual([1, 2, 3, 4]);
      m.doc.arr.sort((a, b) => b - a);
      m = await PortedDocs.saveAndFind(t, Numbers, m);
      expect([...m.doc.arr]).toEqual([4, 3, 2, 1]);
    });
  });

  describe("set()", () => {
    // ported from mongoose test/types.array.test.js:1180 "works combined with other ops"
    // divergence: set(4, 99) on a 4-element array appended in Mongoose; Typemo's set() takes an existing
    // position (no holes), so the append is push(99). `remove(10)` is pull(10).
    test("works combined with other ops", async () => {
      let doc = await PortedDocs.create(t, Numbers, { arr: [3, 4, 5, 6] });
      doc.doc.arr.push(20);
      doc.doc.arr.set(2, 10);
      expect(doc.doc.arr.length).toBe(5);
      expect(doc.doc.arr[2]).toBe(10);
      expect(doc.doc.arr[4]).toBe(20);
      doc = await PortedDocs.saveAndFind(t, Numbers, doc);
      expect([...doc.doc.arr]).toEqual([3, 4, 10, 6, 20]);
      doc.doc.arr.pop();
      doc.doc.arr.push(99);
      doc.doc.arr.pull(10);
      expect([...doc.doc.arr]).toEqual([3, 4, 6, 99]);
      doc = await PortedDocs.saveAndFind(t, Numbers, doc);
      expect([...doc.doc.arr]).toEqual([3, 4, 6, 99]);
    });

    // ported from mongoose test/types.array.test.js:1222 "works with numbers"
    test("works with numbers", async () => {
      let doc = await PortedDocs.create(t, Numbers, { arr: [3, 4, 5, 6] });
      doc.doc.arr.set(2, 10);
      expect(doc.ops()).toEqual({ $set: { "arr.2": 10 } });
      doc = await PortedDocs.saveAndFind(t, Numbers, doc);
      expect([...doc.doc.arr]).toEqual([3, 4, 10, 6]);
    });
  });

  describe("setting a doc array", () => {
    // ported from mongoose test/types.array.test.js:1504 "should adjust path positions"
    // divergence: `d.em1 = x` is `replace(x)` in the strict variant.
    test("should adjust path positions", async () => {
      let d = await PortedDocs.create(t, Kinds, {
        types: [{ type: "pos0" }, { type: "pos1" }, { type: "pos2" }],
        nums: [],
        strs: [],
      });
      const n = d.doc.types.slice();
      const two = n[2];
      const one = n[1];
      if (two === undefined || one === undefined) throw new Error("seed");
      two.type = "position two";
      d.doc.types.replace([two, one]);
      d = await PortedDocs.saveAndFind(t, Kinds, d);
      expect(d.doc.types[0]?.type).toBe("position two");
      expect(d.doc.types[1]?.type).toBe("pos1");
    });
  });

  describe("bug fixes", () => {
    // ported from mongoose test/types.array.test.js:1593 "modifying subdoc props and manipulating the array works (gh-842)"
    // divergence: `m.em[1].deleteOne()` is `m.em.pull(m.em[1])` (removal through the owning array).
    test("modifying subdoc props and manipulating the array works (gh-842)", async () => {
      let m = await PortedDocs.create(t, Users, { em: [{ username: "Arrietty" }] });
      const first = m.doc.em[0];
      if (first) first.username = "Shawn";
      m.doc.em.push({ username: "Homily" });
      m = await PortedDocs.saveAndFind(t, Users, m);
      expect(m.doc.em.map((user) => user.username)).toEqual(["Shawn", "Homily"]);
      const again = m.doc.em[0];
      if (again) again.username = "Arrietty";
      const second = m.doc.em[1];
      if (second) m.doc.em.pull(second);
      m = await PortedDocs.saveAndFind(t, Users, m);
      expect(m.doc.em.map((user) => user.username)).toEqual(["Arrietty"]);
    });

    // ported from mongoose test/types.array.test.js:1618 "toObject returns a vanilla JavaScript array (gh-9540)"
    test("toObject returns a vanilla JavaScript array (gh-9540)", async () => {
      const doc = await PortedDocs.create(t, Numbers, { arr: [1, 2, 3] });
      const arr = doc.doc.arr.$toObject();
      expect(Array.isArray(arr)).toBe(true);
      expect(arr.constructor).toBe(Array);
      expect(arr).toEqual([1, 2, 3]);
    });

    // ported from mongoose test/types.array.test.js:1635 "pushing top level arrays and subarrays works (gh-1073)"
    test("pushing top level arrays and subarrays works (gh-1073)", async () => {
      let m = await PortedDocs.create(t, Subs, { em: [{ sub: [] }] });
      m.doc.em[m.doc.em.length - 1]?.sub.push("a");
      m.doc.em.push({ sub: [] });
      expect(m.doc.em.length).toBe(2);
      expect(m.doc.em[0]?.sub.length).toBe(1);
      m = await PortedDocs.saveAndFind(t, Subs, m);
      expect(m.doc.em.length).toBe(2);
      expect(m.doc.em[0]?.sub.length).toBe(1);
      expect(m.doc.em[0]?.sub[0]).toBe("a");
    });

    // ported from mongoose test/types.array.test.js:1656 "finding ids by string (gh-4011)"
    // divergence (strict cast): with `_id: String`, an ObjectId is not converted to its hex string.
    test("finding ids by string (gh-4011)", async () => {
      const doc = await PortedDocs.create(t, StringIds, { subs: [{ _id: "57067021ee0870440c76f489" }] });
      expect(doc.doc.subs.id("57067021ee0870440c76f489")).toBeDefined();
      /* cast: bypasses the type to test the runtime guard — id() with an id of the wrong type (JS caller) */
      const untyped = doc.doc.subs as unknown as { id(v: unknown): unknown };
      expect(() => untyped.id(new ObjectId("57067021ee0870440c76f489"))).toThrow(CastError);
    });
  });

  describe("built-in array methods that modify element structure return vanilla arrays (gh-8356)", () => {
    // ported from mongoose test/types.array.test.js:1817 "filter", :1826 "flat", :1839 "flatMap", :1852 "map", :1861 "slice"
    test.each([
      ["filter", (a: StrictArray<number>) => a.filter((n) => n > 4), [6, 8]],
      ["flatMap", (a: StrictArray<number>) => a.flatMap((v) => [v, v + 1]), [2, 3, 4, 5, 6, 7, 8, 9]],
      ["map", (a: StrictArray<number>) => a.map((v) => v / 2), [1, 2, 3, 4]],
      ["slice", (a: StrictArray<number>) => a.slice(1, 3), [4, 6]],
    ] as const)("%s", async (_name, run, expected) => {
      const doc = await PortedDocs.create(t, Numbers, { arr: [2, 4, 6, 8] });
      const out = run(doc.doc.arr);
      expect(out).toEqual([...expected]);
      expect(Collections.isTracked(out)).toBe(false);
      expect(out.constructor).toBe(Array);
    });

    test("flat", async () => {
      const doc = await PortedDocs.create(t, Matrix, { intArr: [], arr: [["foo"]] });
      const arr = doc.doc.arr?.flat();
      expect(arr).toEqual(["foo"]);
      expect(Collections.isTracked(arr)).toBe(false);
    });
  });

  // ported from mongoose test/types.array.test.js:1871 "does not mutate passed-in array (gh-10766)"
  // divergence (strict cast): 42 is not cast to "42"; the input is still not mutated.
  test("does not mutate passed-in array (gh-10766)", async () => {
    const arr = Object.freeze(["42"]);
    const doc = await PortedDocs.create(t, Strings, { arr });
    expect(doc.doc.arr[0]).toBe("42");
    doc.doc.arr.replace(arr);
    doc.doc.arr.push(...arr);
    expect(arr).toEqual(["42"]);
    expect(Collections.isTracked(arr)).toBe(false);
  });

  // ported from mongoose test/types.array.test.js:1924 "supports setting nested arrays directly (gh-13372)"
  // divergence: `doc.intArr[0][0] = 2` is `doc.intArr[0].set(0, 2)` in the strict variant.
  test("supports setting nested arrays directly (gh-13372)", () => {
    const doc = TrackedRoot.hydrate<Matrix>(
      {
        _id: new ObjectId(),
        intArr: [
          [1, 2],
          [3, 4],
        ],
      },
      SchemaCompiler.compile(Matrix),
    );
    doc.doc.intArr[0]?.set(0, 2);
    doc.doc.intArr[1]?.set(1, 5);
    expect(doc.ops()).toEqual({ $set: { "intArr.0.0": 2, "intArr.1.1": 5 } });
  });
});
