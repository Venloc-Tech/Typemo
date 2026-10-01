/*
 * Ported from mongoose test/types.documentarray.test.js. Flow: PortedDocs (Typemo `create`,
 * tracked fields, save with the driver). Differences of the strict variant are marked `divergence`.
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
  Spec,
  type Subdocument,
} from "../../../src/internal.ts";
import { PortedDocs } from "../../fixtures/collections/ported-docs.ts";
import { TrackedRoot } from "../../fixtures/collections/tracked-root.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("p_types_docarray");

@Schema()
class Titled extends Entity {
  @Prop(() => String) title?: string;
}

@Schema()
class NumberId {
  @Prop(() => Number) _id!: number;
  @Prop(() => String) title?: string;
}

@Schema({ collection: "pd_titled" })
class TitledDocs extends Entity {
  @Prop(() => [Titled]) docs!: Titled[];
  @Prop(() => [NumberId]) numbered?: NumberId[];
}

@Schema()
class Named extends Entity {
  @Prop(() => String) name?: string;
  @Prop(() => Date) date?: Date;
}

@Schema({ collection: "pd_named" })
class NamedDocs extends Entity {
  @Prop(() => String) name?: string;
  @Prop(() => [Named]) children!: Named[];
}

@Schema()
class Comment extends Entity {
  @Prop(() => String) title?: string;
  @Prop(() => [Comment]) comments?: Comment[];
}

@Schema({ collection: "pd_posts" })
class Post extends Entity {
  @Prop(() => String) title?: string;
  @Prop(() => [Comment]) comments!: Comment[];
}

@Schema()
class Child {
  @Prop(() => String, { required: true }) name!: string;
}

@Schema({ collection: "pd_parents" })
class Parent extends Entity {
  @Prop(() => [Child]) children!: Child[];
}

@Schema()
class Address extends Entity {
  @Prop(() => String) street?: string;
  @Prop(() => String) city?: string;
}

@Schema({ collection: "pd_users" })
class User extends Entity {
  @Prop(() => String) name?: string;
  @Prop(() => [Address]) addresses!: Address[];
}

@Schema({ collection: "pd_maps" })
class MapOfArrays extends Entity {
  @Prop(() => Spec.map([Named])) myMap!: Map<string, Named[]>;
}

const addresses = [
  { street: "1 Main", city: "Boston" },
  { street: "2 Main", city: "Chicago" },
  { street: "3 Main", city: "Denver" },
];
const cities = (user: TrackedRoot<User>) => user.doc.addresses.map((address) => address.city);

describe("types.documentarray", () => {
  // ported from mongoose test/types.documentarray.test.js:66 "behaves and quacks like an array"
  test("behaves and quacks like an array", async () => {
    const doc = await PortedDocs.create(t, TitledDocs, { docs: [] });
    // biome-ignore lint/suspicious/useIsArray: ported assertion — the value is an Array instance, not only array-like
    expect(doc.doc.docs instanceof Array).toBe(true);
    expect(Array.isArray(doc.doc.docs)).toBe(true);
    expect(Collections.isTracked(doc.doc.docs)).toBe(true);
  });

  // ported from mongoose test/types.documentarray.test.js:79 "#id"
  // divergence (strict): an id that is not of the `_id` type (a non-hex string, `undefined`, `null`)
  // is a CastError, not "not found"; ids of object type are not ported (no such `_id` here).
  test("#id", async () => {
    const id = new ObjectId();
    const doc = await PortedDocs.create(t, TitledDocs, {
      docs: [{ _id: id, title: "Hello again to all my friends" }],
      numbered: [{ _id: 1995, title: "rock-n-roll" }],
    });
    expect(doc.doc.docs.id(id)?.title).toBe("Hello again to all my friends");
    expect(doc.doc.docs.id(new ObjectId(id.toHexString()))?.title).toBe("Hello again to all my friends");
    expect(doc.doc.numbered?.id(1995)?.title).toBe("rock-n-roll");
    expect(doc.doc.docs.id(new ObjectId())).toBeUndefined();
    /* cast: bypasses the type to test the runtime guard — id() with an id of the wrong type (JS caller) */
    const untyped = doc.doc.docs as unknown as { id(v: unknown): unknown };
    expect(() => untyped.id("i better not throw")).toThrow(CastError);
    expect(() => untyped.id(undefined)).toThrow(CastError);
    expect(() => untyped.id(null)).toThrow(CastError);
  });

  // ported from mongoose test/types.documentarray.test.js:191 "#id with custom schematype (gh-15725)"
  // divergence (strict cast, L1-1): '42' is not cast to 42.
  test("#id with custom schematype (gh-15725)", async () => {
    const doc = await PortedDocs.create(t, TitledDocs, { docs: [], numbered: [{ _id: 42, title: "Hello" }] });
    expect(doc.doc.numbered?.id(42)?.title).toBe("Hello");
    expect(doc.doc.numbered?.id(43)).toBeUndefined();
    /* cast: bypasses the type to test the runtime guard — id() with an id of the wrong type (JS caller) */
    const untyped = doc.doc.numbered as unknown as { id(v: unknown): unknown };
    expect(() => untyped.id("42")).toThrow(CastError);
  });

  describe("create()", () => {
    // ported from mongoose test/types.documentarray.test.js:299 "works"
    // divergence (strict cast): `name: 100` is a CastError; a string is created.
    test("works", async () => {
      const doc = await PortedDocs.create(t, NamedDocs, { children: [] });
      const subdoc = doc.doc.children.create({ name: "100" });
      expect(subdoc._id).toBeInstanceOf(ObjectId);
      expect(subdoc.name).toBe("100");
      expect(subdoc).toBeInstanceOf(Named);
      expect(() => doc.doc.children.create({ name: 100 } as never)).toThrow(CastError);
    });
  });

  describe("push()", () => {
    // ported from mongoose test/types.documentarray.test.js:317 "does not re-cast instances of its embedded doc"
    // The pre('save') hook of the child (sets `date`) belongs to the document's save and is not part here.
    // divergence: pushing an instance that is already in the array stores a COPY (one owner per instance).
    test("does not re-cast instances of its embedded doc", async () => {
      let doc = await PortedDocs.create(t, NamedDocs, { children: [] });
      const c = doc.doc.children.create({ name: "first" });
      doc.doc.children.push(c);
      expect(doc.doc.children[0]).toBe(c);
      doc.doc.children.push(c);
      doc.doc.children.push(c);
      doc = await PortedDocs.saveAndFind(t, NamedDocs, doc);
      expect(doc.doc.children.length).toBe(3);
      for (const child of doc.doc.children) expect(child._id.equals(c._id)).toBe(true);
    });

    // ported from mongoose test/types.documentarray.test.js:346 "corrects #ownerDocument() and index if value was created with array.create() (gh-1385)"
    // divergence: a created subdocument is detached until pushed ($ownerDocument() undefined before).
    test("corrects #ownerDocument() and index if value was created with array.create() (gh-1385)", async () => {
      const m = await PortedDocs.create(t, NamedDocs, { children: [] });
      const doc = m.doc.children.create({ name: "test 1385" });
      expect(doc.$ownerDocument()).toBeUndefined();
      m.doc.children.push(doc);
      expect(doc.$ownerDocument()).toBe(m.fields);
      expect(doc.$index()).toBe(0);
    });

    // ported from mongoose test/types.documentarray.test.js:358 "corrects #ownerDocument() if value was created with array.create() and set() (gh-7504)"
    // divergence: `m.set('docs', [doc])` is `replace([doc])`; the validation part belongs to the document layer.
    test("corrects #ownerDocument() if value was created with array.create() and set() (gh-7504)", async () => {
      const m = await PortedDocs.create(t, NamedDocs, { children: [] });
      const doc = m.doc.children.create({ name: "test" });
      m.doc.children.replace([doc]);
      expect(doc.$ownerDocument()).toBe(m.fields);
      expect(doc.$index()).toBe(0);
    });
  });

  // ported from mongoose test/types.documentarray.test.js:402 "#push should work on ArraySubdocument more than 2 levels deep"
  test("#push should work on ArraySubdocument more than 2 levels deep", async () => {
    let p = await PortedDocs.create(t, Post, { title: "comment nesting", comments: [] });
    const c1 = p.doc.comments.create({ title: "c1", comments: [] });
    const c2 = c1.comments?.create({ title: "c2", comments: [] });
    const c3 = c2?.comments?.create({ title: "c3", comments: [] });
    if (c2 === undefined || c3 === undefined) throw new Error("create");
    p.doc.comments.push(c1);
    c1.comments?.push(c2);
    c2.comments?.push(c3);
    p = await PortedDocs.saveAndFind(t, Post, p);
    p.doc.comments[0]?.comments?.[0]?.comments?.[0]?.comments?.push({ title: "c4" });
    expect(p.ops()).toEqual({
      $push: { "comments.0.comments.0.comments.0.comments": { $each: [expect.objectContaining({ title: "c4" })] } },
    });
    p = await PortedDocs.saveAndFind(t, Post, p);
    expect(p.doc.comments[0]?.comments?.[0]?.comments?.[0]?.comments?.[0]?.title).toBe("c4");
  });

  // ported from mongoose test/types.documentarray.test.js:535 "slice() copies parent and path (gh-8317)"
  test("slice() copies parent and path (gh-8317)", async () => {
    const doc = await PortedDocs.create(t, TitledDocs, { docs: [{ title: "1" }, { title: "2" }] });
    const arr = doc.doc.docs.slice();
    arr.splice(0, 1);
    expect(arr.length).toBe(1);
    expect(doc.doc.docs.length).toBe(2);
    expect(doc.hasChanges()).toBe(false);
  });

  // ported from mongoose test/types.documentarray.test.js:551 "map() works (gh-8317)"
  test("map() works (gh-8317)", async () => {
    const person = await PortedDocs.create(t, NamedDocs, { children: [{ name: "Hafez" }] });
    const friendsNames = person.doc.children.map((friend) => friend.name);
    friendsNames.push("Sam");
    expect(friendsNames).toEqual(["Hafez", "Sam"]);
  });

  // ported from mongoose test/types.documentarray.test.js:565 "slice() after map() works (gh-8399)" and :587 "unshift() after map() works (gh-9012)"
  test("slice() / unshift() after map() work (gh-8399, gh-9012)", async () => {
    const doc = await PortedDocs.create(t, NamedDocs, { children: [{ name: "a" }, { name: "b" }] });
    const mapped = doc.doc.children.map((value) => ({ name: `${value.name} mapped` }));
    mapped.splice(1, 1, { name: "c" });
    mapped.splice(2, 0, { name: "d" });
    expect(mapped.map((value) => value.name)).toEqual(["a mapped", "c", "d"]);
    mapped.unshift({ name: "a inserted" });
    expect(mapped[0]?.name).toBe("a inserted");
    expect(doc.hasChanges()).toBe(false);
  });

  // ported from mongoose test/types.documentarray.test.js:609 "cleans modified subpaths on splice() (gh-7249)"
  test("cleans modified subpaths on splice() (gh-7249)", async () => {
    let parent = await PortedDocs.create(t, Parent, { children: [{ name: "1" }, { name: "2" }] });
    const second = parent.doc.children[1];
    if (second) second.name = "3";
    parent.doc.children.splice(0, 1);
    parent = await PortedDocs.saveAndFind(t, Parent, parent);
    expect(parent.doc.children.$toObject()).toEqual([{ name: "3" }]);
  });

  // ported from mongoose test/types.documentarray.test.js:637 "modifies ownerDocument() on set (gh-8479)"
  // divergence: `doc1.subDocArray = doc2.subDocArray` is `replace(...)`: the elements are COPIED into doc1.
  test("modifies ownerDocument() on set (gh-8479)", async () => {
    const doc1 = await PortedDocs.create(t, NamedDocs, { name: "doc1", children: [{ name: "subDoc" }] });
    const doc2 = await PortedDocs.create(t, NamedDocs, { name: "doc2", children: [{ name: "subDoc" }] });
    doc1.doc.children.replace(doc2.doc.children);
    expect(doc2.doc.children[0]?.$ownerDocument()).toBe(doc2.fields);
    expect(doc1.doc.children[0]?.$ownerDocument()).toBe(doc1.fields);
  });

  // ported from mongoose test/types.documentarray.test.js:664 "modifying subdoc path after `slice()` (gh-8356)"
  test("modifying subdoc path after `slice()` (gh-8356)", async () => {
    const doc = await PortedDocs.create(t, NamedDocs, { name: "test", children: [{ name: "foo" }, { name: "bar" }] });
    const sliced = doc.doc.children.slice(1, 2)[0];
    if (sliced) sliced.name = "baz";
    expect(Collections.modifiedPaths(doc.fields.children)).toEqual(["children.1.name"]);
  });

  // ported from mongoose test/types.documentarray.test.js:699 "keeps atomics after setting (gh-10272)"
  // divergence: `doc.children = [...]` is `replace([...])`.
  test("keeps atomics after setting (gh-10272)", async () => {
    const doc = await PortedDocs.create(t, NamedDocs, { children: [{ name: "John" }, { name: "Jane" }] });
    doc.doc.children.replace([{ name: "John" }]);
    doc.doc.children.replace(doc.doc.children.concat([]));
    doc.doc.children.push({ name: "Mary" });
    const set = doc.ops().$set?.children as { name: string }[];
    expect(set.map((value) => value.name)).toEqual(["John", "Mary"]);
  });

  // ported from mongoose test/types.documentarray.test.js:739 "applies _id default (gh-12264)"
  // divergence: stored data are hydrated as stored (no defaults on read); defaults are the save's.
  // Created elements get the default at once.
  test("applies _id default (gh-12264)", async () => {
    const raw = { _id: new ObjectId(), children: [{ name: "foo" }] };
    const doc = TrackedRoot.hydrate<NamedDocs>(raw, SchemaCompiler.compile(NamedDocs));
    expect(doc.doc.children[0]?._id).toBeUndefined();
    doc.doc.children.push({ name: "bar" });
    expect(doc.doc.children[1]?._id).toBeInstanceOf(ObjectId);
  });

  // ported from mongoose test/types.documentarray.test.js:753 "gets correct path when underneath map (gh-12997)"
  test("gets correct path when underneath map (gh-12997)", async () => {
    const doc = await PortedDocs.create(t, MapOfArrays, { myMap: { foo: [{ name: "bar" }] } });
    const array = doc.doc.myMap.get("foo");
    expect(array === undefined ? undefined : Collections.fullPath(array)).toBe("myMap.foo");
    expect(array?.[0]?.$fullPath()).toBe("myMap.foo.0");
  });

  describe("document array indexes after removal / reordering / addToSet (H029)", () => {
    const run = async (
      name: string,
      change: (user: TrackedRoot<User>) => void,
      index: number,
      expected: readonly string[],
    ) => {
      test(name, async () => {
        let user = await PortedDocs.create(t, User, { name: "John", addresses });
        change(user);
        user = await PortedDocs.saveAndFind(t, User, user);
        expect(user.hasChanges()).toBe(false);
        const element = user.doc.addresses[index] as Subdocument<Address>;
        element.city = "New York";
        expect(element.$fullPath()).toBe(`addresses.${index}`);
        expect(Collections.modifiedPaths(user.fields.addresses)).toEqual([`addresses.${index}.city`]);
        expect(user.ops()).toEqual({ $set: { [`addresses.${index}.city`]: "New York" } });
        user = await PortedDocs.saveAndFind(t, User, user);
        expect(cities(user)).toEqual([...expected]);
      });
    };
    // ported from mongoose test/types.documentarray.test.js:851 "reindexes subdocs after pull() so subsequent nested changes save correctly"
    run("reindexes subdocs after pull()", (u) => void u.doc.addresses.pull(u.doc.addresses[0]?._id as ObjectId), 0, [
      "New York",
      "Denver",
    ]);
    // ported from mongoose test/types.documentarray.test.js:876 "reindexes subdocs after splice() so subsequent nested changes save correctly"
    run("reindexes subdocs after splice()", (u) => void u.doc.addresses.splice(0, 1), 0, ["New York", "Denver"]);
    // ported from mongoose test/types.documentarray.test.js:901 "reindexes subdocs after shift() so subsequent nested changes save correctly"
    run("reindexes subdocs after shift()", (u) => void u.doc.addresses.shift(), 0, ["New York", "Denver"]);
    // ported from mongoose test/types.documentarray.test.js:976 "reindexes subdocs after unshift() so subsequent nested changes save correctly"
    run(
      "reindexes subdocs after unshift()",
      (u) => void u.doc.addresses.unshift({ street: "0 Main", city: "Amsterdam" }),
      1,
      ["Amsterdam", "New York", "Chicago", "Denver"],
    );
    // ported from mongoose test/types.documentarray.test.js:1003 "reindexes subdocs after positioned push() so subsequent nested changes save correctly"
    // divergence: `push({ $each, $position: 0 })` is `unshift(...)`.
    run(
      "reindexes subdocs after positioned push()",
      (u) =>
        void u.doc.addresses.unshift({ street: "0 Main", city: "Amsterdam" }, { street: "0 Main", city: "Rotterdam" }),
      1,
      ["Amsterdam", "New York", "Boston", "Chicago", "Denver"],
    );
    // ported from mongoose test/types.documentarray.test.js:1071 "reindexes subdocs after sort() so subsequent nested changes save correctly"
    run(
      "reindexes subdocs after sort()",
      (u) => void u.doc.addresses.sort((a, b) => (b.city ?? "").localeCompare(a.city ?? "")),
      0,
      ["New York", "Chicago", "Boston"],
    );
    // ported from mongoose test/types.documentarray.test.js:1098 "keeps subdoc indexes correct after reverse() so subsequent nested changes save correctly"
    run("keeps subdoc indexes correct after reverse()", (u) => void u.doc.addresses.reverse(), 0, [
      "New York",
      "Chicago",
      "Boston",
    ]);
    // ported from mongoose test/types.documentarray.test.js:1179 "reindexes subdocs after addToSet() skips a duplicate so subsequent nested changes save correctly"
    run(
      "reindexes subdocs after addToSet() skips a duplicate",
      (u) => {
        const first = u.doc.addresses[0];
        const added = u.doc.addresses.addToSet(
          { _id: first?._id as ObjectId, street: "1 Main", city: "Boston" },
          { street: "4 Main", city: "Amsterdam" },
          { street: "5 Main", city: "Rotterdam" },
        );
        expect(added.map((address) => address.city)).toEqual(["Amsterdam", "Rotterdam"]);
      },
      3,
      ["Boston", "Chicago", "Denver", "New York", "Rotterdam"],
    );
  });

  // ported from mongoose test/types.documentarray.test.js:1041 "does not restamp existing subdocs after append-only push()"
  test("does not restamp existing subdocs after append-only push()", async () => {
    const user = await PortedDocs.create(t, User, { name: "John", addresses });
    user.doc.addresses.push({ street: "4 Main", city: "Austin" });
    expect(user.doc.addresses[3]?.$fullPath()).toBe("addresses.3");
    expect(user.doc.addresses[0]?.$fullPath()).toBe("addresses.0");
  });

  // ported from mongoose test/types.documentarray.test.js:1125 "registers full array atomics after reverse() follows append-only push()"
  // The `$inc: { __v: 1 }` of Mongoose is the versioning of the document layer (VersionImpact "increment" here).
  test("registers full array atomics after reverse() follows append-only push()", async () => {
    const user = await PortedDocs.create(t, User, { name: "John", addresses });
    user.doc.addresses.push({ street: "4 Main", city: "Austin" });
    expect(Object.keys(user.ops())).toEqual(["$push"]);
    const ret = user.doc.addresses.reverse();
    expect(ret).toBe(user.doc.addresses);
    const delta = Collections.toUpdateOps(user.fields.addresses, "db");
    expect(Object.keys(delta.ops)).toEqual(["$set"]);
    expect(delta.version).toBe("increment");
    expect(((delta.ops.$set?.addresses ?? []) as { city: string }[]).map((address) => address.city)).toEqual([
      "Austin",
      "Denver",
      "Chicago",
      "Boston",
    ]);
  });
});
