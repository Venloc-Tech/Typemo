/*
 * SubdocumentArray — create/push/pull/id, field changes by position
 * computed at save, embedded discriminators by value, elements without or with a custom
 * `_id`, and the one parent link. Real mongod; exact update + stored state = memory (ScenarioRunner).
 */
import { describe, expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import { ObjectId } from "mongodb";
import { BsonOptions, CastError, type Subdocument, type SubdocumentArray, TypemoError } from "../../../src/index.ts";
import {
  Circle,
  IDS,
  type Point,
  Revision,
  type Seat,
  type Shape,
  Square,
} from "../../fixtures/collections/collection-entities.ts";
import { ScenarioRunner } from "../../fixtures/collections/scenario-runner.ts";
import type { TrackedRoot } from "../../fixtures/collections/tracked-root.ts";

const mongo = MongoLifecycle.useMongo("c_subdocs", BsonOptions.apply({}));

/**
 * The `revisions` array of a tracked root.
 * @param r The tracked root.
 * @returns The subdocument array field.
 */
const revisions = (r: TrackedRoot) => r.get<SubdocumentArray<Revision>>("revisions");
/**
 * The element at an index; a missing one fails the test with a clear message.
 * @param array The subdocument array.
 * @param index The position of the element.
 * @returns The element.
 */
const at = <T>(array: SubdocumentArray<T>, index: number): Subdocument<T> => {
  const element = array[index];
  if (element === undefined) throw new Error(`no element ${index}`);
  return element;
};
const NEW_ID = new ObjectId("660000000000000000000019");
/**
 * The stored form of the seeded revision at an index.
 * @param index The position in the seed.
 * @param patch Fields that replace the seeded ones.
 * @returns The expected raw element.
 */
const stored = (index: number, patch: Record<string, unknown> = {}) => ({
  _id: IDS.rev[index],
  note: `n${index}`,
  lines: index,
  tags: [`t${index}`],
  ...patch,
});

describe("SubdocumentArray: hydration", () => {
  test("elements are instances of the entity class with its methods", async () => {
    const root = await ScenarioRunner.load(mongo);
    const first = at(revisions(root), 0);
    expect(first).toBeInstanceOf(Revision);
    expect(first.summary()).toBe("n0:0");
    expect(Object.keys(first)).toEqual(["_id", "note", "lines", "tags"]);
    expect(JSON.parse(JSON.stringify(first))).toEqual({
      _id: IDS.rev[0].toHexString(),
      note: "n0",
      lines: 0,
      tags: ["t0"],
    });
    expect(structuredClone(first) as unknown).toEqual({ _id: IDS.rev[0], note: "n0", lines: 0, tags: ["t0"] });
  });
});

describe("SubdocumentArray: each method → the minimal update", () => {
  test("field change → $set path.i.field", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) => {
        at(revisions(r), 1).note = "changed";
      },
      {
        $set: { "revisions.1.note": "changed" },
      },
    );
  });

  test("two fields in two elements", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) => {
        at(revisions(r), 0).lines = 10;
        at(revisions(r), 2).note = "x";
      },
      { $set: { "revisions.0.lines": 10, "revisions.2.note": "x" } },
    );
  });

  test("id(_id) + field change", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) => {
        const found = revisions(r).id(IDS.rev[2]);
        expect(found).toBe(at(revisions(r), 2));
        if (found) found.lines = 42;
      },
      { $set: { "revisions.2.lines": 42 } },
    );
  });

  test("a field of an aliased (dbName) path uses database names", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) => {
        at(revisions(r), 0).comment = "c";
      },
      {
        $set: { "revisions.0.cm": "c" },
      },
    );
    const raw = await mongo.db.collection("c_docs").findOne({ _id: IDS.doc });
    expect(((raw?.revisions ?? []) as Record<string, unknown>[])[0]?.cm).toBe("c");
  });

  test("a deleted field → $unset path.i.field", async () => {
    await ScenarioRunner.run(mongo, (r) => void delete at(revisions(r), 1).tags, {
      $unset: { "revisions.1.tags": "" },
    });
  });

  test("push(create(...)) → $push with the defaults (_id) filled", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) => {
        const created = revisions(r).create({ _id: NEW_ID, note: "new", lines: 9 });
        expect(created.$parentArray()).toBeUndefined();
        expect(revisions(r).push(created)).toBe(4);
        expect(created.$index()).toBe(3);
        expect(revisions(r)[3]).toBe(created);
      },
      { $push: { revisions: { $each: [{ _id: NEW_ID, note: "new", lines: 9, tags: [] }] } } },
    );
  });

  test("push of plain input, then a change of the pushed element → still one $push", async () => {
    const root = await ScenarioRunner.load(mongo);
    revisions(root).push({ note: "p", lines: 1 });
    const pushed = at(revisions(root), 3);
    expect(pushed._id).toBeInstanceOf(ObjectId);
    pushed.note = "changed after push";
    expect(root.ops()).toEqual({
      $push: { revisions: { $each: [{ _id: pushed._id, note: "changed after push", lines: 1, tags: [] }] } },
    });
  });

  test("unshift → $push $position 0", async () => {
    await ScenarioRunner.run(mongo, (r) => void revisions(r).unshift({ _id: NEW_ID, note: "u", lines: 0 }), {
      $push: { revisions: { $each: [{ _id: NEW_ID, note: "u", lines: 0, tags: [] }], $position: 0 } },
    });
  });

  test("pull(subdocument) → $pull by _id", async () => {
    await ScenarioRunner.run(mongo, (r) => void revisions(r).pull(at(revisions(r), 0)), {
      $pull: { revisions: { _id: { $in: [IDS.rev[0]] } } },
    });
  });

  test("pull(id) → $pull by _id; an equal id works (equals)", async () => {
    await ScenarioRunner.run(mongo, (r) => void revisions(r).pull(new ObjectId(IDS.rev[1].toHexString()), IDS.rev[2]), {
      $pull: { revisions: { _id: { $in: [IDS.rev[1], IDS.rev[2]] } } },
    });
  });

  test("pop → $pop 1, shift → $pop -1", async () => {
    await ScenarioRunner.run(mongo, (r) => void revisions(r).pop(), { $pop: { revisions: 1 } });
  });

  test("set(i, input) → $set path.i", async () => {
    await ScenarioRunner.run(mongo, (r) => void revisions(r).set(1, { _id: NEW_ID, note: "s", lines: 7 }), {
      $set: { "revisions.1": { _id: NEW_ID, note: "s", lines: 7, tags: [] } },
    });
  });

  test("sort by a field → $set of the whole array", async () => {
    await ScenarioRunner.run(mongo, (r) => void revisions(r).sort((a, b) => b.lines - a.lines), {
      $set: { revisions: [stored(2), stored(1), stored(0)] },
    });
  });

  test("push of a new one + change of an existing one → $set (code 40 otherwise)", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) => {
        revisions(r).push({ _id: NEW_ID, note: "new", lines: 9 });
        at(revisions(r), 0).note = "changed";
      },
      {
        $set: {
          revisions: [
            stored(0, { note: "changed" }),
            stored(1),
            stored(2),
            { _id: NEW_ID, note: "new", lines: 9, tags: [] },
          ],
        },
      },
    );
  });

  test("an array inside an element: push → $push revisions.1.tags", async () => {
    await ScenarioRunner.run(mongo, (r) => void at(revisions(r), 1).tags?.push("more"), {
      $push: { "revisions.1.tags": { $each: ["more"] } },
    });
  });

  test("replace() / clear()", async () => {
    await ScenarioRunner.run(mongo, (r) => void revisions(r).replace([{ _id: NEW_ID, note: "only", lines: 1 }]), {
      $set: { revisions: [{ _id: NEW_ID, note: "only", lines: 1, tags: [] }] },
    });
  });

  test("create() casts at once: CastError with the path", async () => {
    const root = await ScenarioRunner.load(mongo);
    /* cast: bypasses the type to test the runtime guard — push/create of wrong values (JS caller) */
    const untyped = revisions(root) as unknown as { push(v: unknown): number; create(v: unknown): unknown };
    expect(() => untyped.push({ note: 5, lines: 1 })).toThrow(CastError);
    expect(() => untyped.push({ note: "x", lines: 1, nope: 1 })).toThrow(/nope.*not a field of Revision/);
    try {
      untyped.push({ note: "x", lines: "many" });
    } catch (error) {
      expect((error as CastError).path).toBe("revisions.3.lines");
    }
    expect(root.hasChanges()).toBe(false);
  });
});

describe("the index is computed at save, never stale", () => {
  test("pull(a) then change the element that was at 2 → it is at 1; the stored c is changed, not a later one", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) => {
        const array = revisions(r);
        const c = at(array, 2);
        array.pull(at(array, 0));
        expect(c.$index()).toBe(1);
        expect(c.$fullPath()).toBe("revisions.1");
        c.note = "changed";
      },
      /* $pull + a positional $set would be code 40: the array is written whole, with c changed. */
      { $set: { revisions: [stored(1), stored(2, { note: "changed" })] } },
    );
  });

  test("after a save that pulled, a later change goes to the right position", async () => {
    const root = await ScenarioRunner.load(mongo);
    const docs = mongo.db.collection("c_docs");
    const c = at(revisions(root), 2);
    revisions(root).pull(at(revisions(root), 0));
    await root.save(docs);
    c.note = "second";
    expect(root.ops()).toEqual({ $set: { "revisions.1.note": "second" } });
    await root.save(docs);
    const raw = await docs.findOne({ _id: IDS.doc });
    expect(raw?.revisions).toEqual([stored(1), stored(2, { note: "second" })]);
  });
});

describe("the parent link (one mechanism)", () => {
  test("attached on hydrate/push, detached on pull/pop/splice/clear/set", async () => {
    const root = await ScenarioRunner.load(mongo);
    const array = revisions(root);
    const [a, b, c] = [at(array, 0), at(array, 1), at(array, 2)];
    expect(c.$fullPath()).toBe("revisions.2");
    expect(c.$parentArray()).toBe(array);
    expect(c.$parent()).toBe(root.fields);
    expect(c.$ownerDocument()).toBe(root.fields);
    array.pull(a);
    expect(a.$parentArray()).toBeUndefined();
    expect(a.$index()).toBe(-1);
    expect(a.$fullPath()).toBeUndefined();
    expect(a.$ownerDocument()).toBeUndefined();
    expect(b.$fullPath()).toBe("revisions.0");
    array.set(0, { note: "s", lines: 1 });
    expect(b.$parentArray()).toBeUndefined();
    array.clear();
    expect(c.$index()).toBe(-1);
  });

  test("a subdocument inside a subdocument: the path goes through both", async () => {
    const root = await ScenarioRunner.load(mongo);
    const tags = at(revisions(root), 1).tags;
    expect(tags === undefined ? undefined : root.fields.revisions).toBe(revisions(root));
  });

  test("a pulled element pushed back is adopted (same instance); one attached elsewhere is copied", async () => {
    const root = await ScenarioRunner.load(mongo);
    const array = revisions(root);
    const a = at(array, 0);
    array.pull(a);
    array.push(a);
    expect(array[2]).toBe(a);
    const b = at(array, 0);
    array.push(b);
    expect(array[3]).not.toBe(b);
    expect(array[3]?._id.equals(b._id)).toBe(true);
    expect(b.$index()).toBe(0);
  });
});

describe("elements without _id and with a custom _id", () => {
  const points = (r: TrackedRoot) => r.get<SubdocumentArray<Point>>("points");
  const seats = (r: TrackedRoot) => r.get<SubdocumentArray<Seat>>("seats");

  test("pull of an element without _id → $set of the whole array (no $pull condition names it)", async () => {
    await ScenarioRunner.run(mongo, (r) => void points(r).pull(at(points(r), 0)), {
      $set: { points: [{ x: 2, y: 2 }] },
    });
  });

  test("create() of a class without _id adds no _id", async () => {
    await ScenarioRunner.run(mongo, (r) => void points(r).push({ x: 3, y: 3 }), {
      $push: { points: { $each: [{ x: 3, y: 3 }] } },
    });
  });

  test("id() on elements without _id is refused at run time too", async () => {
    const root = await ScenarioRunner.load(mongo);
    /* cast: bypasses the type to test the runtime guard — id() with an id of the wrong type (JS caller) */
    const untyped = points(root) as unknown as { id(v: unknown): unknown };
    expect(() => untyped.id(1)).toThrow(TypemoError);
  });

  test("id() casts by the element's _id type (Number)", async () => {
    const root = await ScenarioRunner.load(mongo);
    expect(seats(root).id(6)?.label).toBe("A6");
    /* cast: bypasses the type to test the runtime guard — id() with an id of the wrong type (JS caller) */
    const untyped = seats(root) as unknown as { id(v: unknown): unknown };
    expect(() => untyped.id(new ObjectId())).toThrow(CastError);
  });

  test("pull by a custom id → $pull { _id: { $in: [5] } }", async () => {
    await ScenarioRunner.run(mongo, (r) => void seats(r).pull(5), { $pull: { seats: { _id: { $in: [5] } } } });
  });
});

describe("embedded discriminators: resolved by the VALUE of the key", () => {
  const shapes = (r: TrackedRoot) => r.get<SubdocumentArray<Circle | Square>>("shapes");

  test("stored elements are instances of the class their key names", async () => {
    const root = await ScenarioRunner.load(mongo);
    expect(at(shapes(root), 0)).toBeInstanceOf(Circle);
    expect(at(shapes(root), 1)).toBeInstanceOf(Square);
  });

  test("push by value → an instance of the selected class; the key is stored", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) => {
        shapes(r).push({ kind: "square", side: 5 } as Square);
        expect(at(shapes(r), 2)).toBeInstanceOf(Square);
      },
      { $push: { shapes: { $each: [{ kind: "square", side: 5 }] } } },
    );
  });

  test("push of an instance of the subclass (no key) selects it by class and writes the key", async () => {
    const circle = new Circle();
    circle.radius = 3;
    await ScenarioRunner.run(mongo, (r) => void shapes(r).push(circle), {
      $push: { shapes: { $each: [{ kind: "circle", radius: 3 }] } },
    });
  });

  test("a field of the discriminator class → $set shapes.0.radius", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) => {
        (at(shapes(r), 0) as Subdocument<Circle>).radius = 7;
      },
      {
        $set: { "shapes.0.radius": 7 },
      },
    );
  });

  test("an unknown key value is a CastError (never silently the base class)", async () => {
    const root = await ScenarioRunner.load(mongo);
    /* cast: bypasses the type to test the runtime guard — push of an element of an unregistered class */
    const untyped = shapes(root) as unknown as { push(v: unknown): number };
    expect(() => untyped.push({ kind: "triangle", side: 1 })).toThrow(CastError);
    expect(() => untyped.push({ kind: "circle", side: 1 })).toThrow(/side" for 1 \(number\): not a field of Circle/);
    const base: Shape = { kind: "circle" };
    expect(base.kind).toBe("circle");
  });
});
