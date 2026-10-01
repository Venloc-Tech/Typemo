/*
 * Ported from mongoose test/types.map.test.js: the Map side of the tracked collections.
 * Validators (`validate`, `required`) run in the document's save and are not part of these ports.
 */
import { describe, expect, test } from "bun:test";
import {
  CastError,
  Collections,
  Discriminator,
  type DiscriminatorValue,
  Entity,
  Prop,
  Schema,
  Spec,
} from "../../../src/index.ts";
import { PortedDocs } from "../../fixtures/collections/ported-docs.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("p_types_map");

@Schema({ collection: "pm_numbers" })
class Numbers extends Entity {
  @Prop(() => Spec.map(Number)) v!: Map<string, number>;
}

@Schema({ collection: "pm_facts" })
class Person extends Entity {
  @Prop(() => String) name?: string;
  @Prop(() => Spec.map(Boolean)) fact!: Map<string, boolean>;
}

@Schema()
class N {
  @Prop(() => Number) n?: number;
}

@Schema({ collection: "pm_embedded" })
class Embedded extends Entity {
  @Prop(() => Spec.map(N)) m!: Map<string, N>;
}

@Schema()
class Employee {
  @Prop(() => String) __t!: string;
  @Prop(() => String) name?: string;
}

@Discriminator("Sales")
class Sales extends Employee {
  declare readonly __t: DiscriminatorValue<"Sales">;
  @Prop(() => [String]) clients?: string[];
}

@Discriminator("Engineering")
class Engineering extends Employee {
  declare readonly __t: DiscriminatorValue<"Engineering">;
  @Prop(() => Spec.map(String)) apiKeys?: Map<string, string>;
}

@Schema({ collection: "pm_departments" })
class Department extends Entity {
  @Prop(() => [Employee]) employees!: (Sales | Engineering)[];
}

@Schema()
class Child {
  @Prop(() => String) name?: string;
}

@Schema({ collection: "pm_children" })
class Crew extends Entity {
  @Prop(() => Spec.map(Number)) numMap!: Map<string, number>;
  @Prop(() => Spec.map(Child)) docMap!: Map<string, Child>;
}

@Schema({ collection: "pm_boards" })
class Board extends Entity {
  @Prop(() => Spec.map(Number)) elements!: Map<string, number>;
}

@Schema({ collection: "pm_budgets" })
class Budget extends Entity {
  @Prop(() => Spec.map([Number])) budgeted!: Map<string, number[]>;
}

@Schema({ collection: "pm_cars" })
class Car extends Entity {
  @Prop(() => Spec.map(Child)) owners!: Map<string, Child>;
  @Prop(() => Spec.map([Child])) lists?: Map<string, Child[]>;
}

@Schema({ nested: true })
class Text {
  @Prop(() => String) text?: string;
}

@Schema({ collection: "pm_nullable_messages" })
class Messages extends Entity {
  @Prop(() => Spec.map(Text, { nullable: true })) messages!: Map<string, Text | null>;
}

@Schema({ collection: "pm_maps_of_maps" })
class MapOfMaps extends Entity {
  @Prop(() => Spec.map(Spec.map(Number))) map!: Map<string, Map<string, number>>;
}

describe("Map", () => {
  // ported from mongoose test/types.map.test.js:34 "validation" (the cast part; validators are 7A's save)
  test("validation", async () => {
    const doc = await PortedDocs.create(t, Numbers, { v: { x: 1 } });
    expect(doc.doc.v).toBeInstanceOf(Map);
    let caught: unknown;
    try {
      await PortedDocs.create(t, Numbers, { v: { notA: "number" } as never });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CastError);
    expect((caught as CastError).path).toBe("v.notA");
    doc.doc.v.set("y", 5);
    expect(doc.ops()).toEqual({ $set: { "v.y": 5 } });
  });

  // ported from mongoose test/types.map.test.js:134 "supports delete() (gh-7743)"
  test("supports delete() (gh-7743)", async () => {
    const person = await PortedDocs.create(t, Person, {
      name: "Arya Stark",
      fact: { cool: true, girl: true, killer: true },
    });
    expect(person.doc.fact.get("killer")).toBe(true);
    person.doc.fact.delete("killer");
    expect(person.ops()).toEqual({ $unset: { "fact.killer": "" } });
    expect([...person.doc.fact.keys()].sort()).toEqual(["cool", "girl"]);
    expect(person.doc.fact.get("killer")).toBeUndefined();
    const found = await PortedDocs.saveAndFind(t, Person, person);
    expect(found.doc.fact.get("killer")).toBeUndefined();
  });

  // ported from mongoose test/types.map.test.js:273 "with single nested subdocs"
  test("with single nested subdocs", async () => {
    let doc = await PortedDocs.create(t, Embedded, { m: { bacon: { n: 2 } } });
    expect(doc.doc.m).toBeInstanceOf(Map);
    expect(doc.doc.m.get("bacon")?.$toObject()).toEqual({ n: 2 });
    const bacon = doc.doc.m.get("bacon");
    if (bacon) bacon.n = 4;
    expect(doc.ops()).toEqual({ $set: { "m.bacon.n": 4 } });
    doc = await PortedDocs.saveAndFind(t, Embedded, doc);
    expect(doc.doc.m.get("bacon")?.$toObject()).toEqual({ n: 4 });
  });

  // ported from mongoose test/types.map.test.js:506 "embedded discriminators"
  test("embedded discriminators", async () => {
    let dept = await PortedDocs.create(t, Department, {
      employees: [
        { __t: "Sales", name: "E1", clients: ["test1", "test2"] },
        { __t: "Engineering", name: "E2", apiKeys: { github: "test3" } },
      ],
    });
    expect(dept.doc.employees[0]?.$toObject()).toEqual({ __t: "Sales", name: "E1", clients: ["test1", "test2"] });
    // The element union narrows by the declared key, no cast needed.
    const engineer = dept.doc.employees[1];
    if (engineer?.__t !== "Engineering" || engineer.apiKeys === undefined) throw new Error("expected an engineer");
    expect([...engineer.apiKeys.values()]).toEqual(["test3"]);
    engineer.apiKeys.set("github", "test4");
    expect(dept.ops()).toEqual({ $set: { "employees.1.apiKeys.github": "test4" } });
    dept = await PortedDocs.saveAndFind(t, Department, dept);
    const found = await t.mongo.db.collection("pm_departments").findOne({ "employees.apiKeys.github": "test4" });
    expect(found).not.toBeNull();
    expect(dept.doc.employees[1]).toBeInstanceOf(Engineering);
  });

  // ported from mongoose test/types.map.test.js:813 "avoids marking path as modified if setting to same value (gh-8652)"
  test("avoids marking path as modified if setting to same value (gh-8652)", async () => {
    const doc = await PortedDocs.create(t, Crew, {
      numMap: { answer: 42, powerLevel: 9001 },
      docMap: { captain: { name: "Jean-Luc Picard" }, firstOfficer: { name: "Will Riker" } },
    });
    doc.doc.numMap.set("answer", 42);
    doc.doc.numMap.set("powerLevel", 9001);
    doc.doc.docMap.set("captain", { name: "Jean-Luc Picard" });
    doc.doc.docMap.set("firstOfficer", { name: "Will Riker" });
    expect(Collections.modifiedPaths(doc.fields.numMap)).toEqual([]);
    expect(Collections.modifiedPaths(doc.fields.docMap)).toEqual([]);
    expect(doc.hasChanges()).toBe(false);
  });

  // ported from mongoose test/types.map.test.js:847 "handles setting map value to spread document (gh-8652)"
  test("handles setting map value to spread document (gh-8652)", async () => {
    let doc = await PortedDocs.create(t, Crew, {
      numMap: {},
      docMap: { captain: { name: "Jean-Luc Picard" }, firstOfficer: { name: "Will Riker" } },
    });
    doc.doc.docMap.set("captain", { ...doc.doc.docMap.get("firstOfficer")?.$toObject() });
    doc = await PortedDocs.saveAndFind(t, Crew, doc);
    expect(doc.doc.docMap.get("firstOfficer")?.name).toBe("Will Riker");
    expect(doc.doc.docMap.get("captain")?.name).toBe("Will Riker");
  });

  // ported from mongoose test/types.map.test.js:948 "persists `.clear()` (gh-9493)"
  test("persists `.clear()` (gh-9493)", async () => {
    let board = await PortedDocs.create(t, Board, { elements: {} });
    board.doc.elements.set("a", 1);
    board = await PortedDocs.saveAndFind(t, Board, board);
    board.doc.elements.clear();
    board = await PortedDocs.saveAndFind(t, Board, board);
    expect(board.doc.elements.size).toBe(0);
  });

  // ported from mongoose test/types.map.test.js:968 "supports `null` in map of subdocuments (gh-9628)"
  // Typemo: `null` values need `Spec.map(X, { nullable: true })`; without it null is a CastError.
  test("supports `null` in map of subdocuments (gh-9628)", async () => {
    const Test = t.connection.model(Messages);
    const created = await Test.create({ messages: { prop1: { text: "test" }, prop2: null } });
    const doc = await Test.findById(created._id).orFail();
    expect(doc.messages.get("prop1")?.$toObject()).toEqual({ text: "test" });
    expect(doc.messages.get("prop2")).toBeNull();
    await doc.$validate();
  });

  // ported from mongoose test/types.map.test.js:986 "tracks changes correctly (gh-9811)"
  test("tracks changes correctly (gh-9811)", async () => {
    const doc = await PortedDocs.create(t, Crew, { numMap: {}, docMap: new Map() });
    doc.doc.docMap.set("abc", { name: "some value" });
    expect(doc.ops()).toEqual({ $set: { "docMap.abc": { name: "some value" } } });
  });

  // ported from mongoose test/types.map.test.js:1012 "handles map of arrays (gh-9813)"
  test("handles map of arrays (gh-9813)", async () => {
    let doc = await PortedDocs.create(t, Budget, { budgeted: new Map([["2020", [100, 200, 300]]]) });
    doc.doc.budgeted.get("2020")?.set(2, 10);
    expect(doc.ops()).toEqual({ $set: { "budgeted.2020.2": 10 } });
    doc = await PortedDocs.saveAndFind(t, Budget, doc);
    expect(doc.doc.budgeted.get("2020")?.$toObject()).toEqual([100, 200, 10]);
  });

  // ported from mongoose test/types.map.test.js:1155 "clears nested changes in subdocs (gh-15108)"
  test("clears nested changes in subdocs (gh-15108)", async () => {
    let car = await PortedDocs.create(t, Car, { owners: { abc: { name: "John" } } });
    const owner = car.doc.owners.get("abc");
    if (owner) delete owner.name;
    car.doc.owners.delete("abc");
    expect(car.ops()).toEqual({ $unset: { "owners.abc": "" } });
    car = await PortedDocs.saveAndFind(t, Car, car);
    expect(car.doc.owners.get("abc")).toBeUndefined();
  });

  // ported from mongoose test/types.map.test.js:1178 "clears nested changes in doc arrays (gh-15108)"
  // The `$inc: { __v: 1 }` of Mongoose is the versioning of the document layer.
  test("clears nested changes in doc arrays (gh-15108)", async () => {
    let car = await PortedDocs.create(t, Car, { owners: {}, lists: { abc: [{ name: "John" }] } });
    const first = car.doc.lists?.get("abc")?.[0];
    if (first) delete first.name;
    car.doc.lists?.set("abc", [{ name: "Bill" }]);
    expect(car.ops()).toEqual({ $set: { "lists.abc": [{ name: "Bill" }] } });
    car = await PortedDocs.saveAndFind(t, Car, car);
    expect(car.doc.lists?.get("abc")?.$toObject()).toEqual([{ name: "Bill" }]);
  });

  // ported from mongoose test/types.map.test.js:1231 "handles modifying array in map of primitives (gh-15350)"
  test("handles modifying array in map of primitives (gh-15350)", async () => {
    let doc = await PortedDocs.create(t, Budget, { budgeted: {} });
    doc.doc.budgeted.set("key", [1, 2]);
    doc = await PortedDocs.saveAndFind(t, Budget, doc);
    expect([...(doc.doc.budgeted.get("key") ?? [])]).toEqual([1, 2]);
    doc.doc.budgeted.get("key")?.push(3);
    expect(doc.ops().$push).toEqual({ "budgeted.key": { $each: [3] } });
    doc = await PortedDocs.saveAndFind(t, Budget, doc);
    expect([...(doc.doc.budgeted.get("key") ?? [])]).toEqual([1, 2, 3]);
  });

  // ported from mongoose test/types.map.test.js:1258 "handles maps of maps of numbers (gh-15350)"
  test("handles maps of maps of numbers (gh-15350)", async () => {
    let doc = await PortedDocs.create(t, MapOfMaps, { map: {} });
    doc.doc.map.set("outer", new Map([["inner", 42]]));
    doc = await PortedDocs.saveAndFind(t, MapOfMaps, doc);
    expect(doc.doc.map.get("outer")?.get("inner")).toBe(42);
    doc.doc.map.get("outer")?.set("inner2", 43);
    expect(doc.ops()).toEqual({ $set: { "map.outer.inner2": 43 } });
    doc = await PortedDocs.saveAndFind(t, MapOfMaps, doc);
    expect(doc.doc.map.get("outer")?.get("inner2")).toBe(43);
  });
});
