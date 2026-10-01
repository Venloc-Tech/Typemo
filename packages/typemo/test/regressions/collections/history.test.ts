/*
 * Regressions of research/mongoose/M11-history/history.yaml (area array and change tracking of
 * collections). Each test is named by its Hnnn and follows the entry's `how_to_test`.
 */
import { describe, expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import {
  BsonOptions,
  CastError,
  type CollectionSnapshot,
  Collections,
  DirectWriteError,
  PartialArrayError,
  type StrictArray,
  type Subdocument,
  type SubdocumentArray,
  type TypedMap,
} from "../../../src/index.ts";
import { type Badge, IDS, Point, type Revision, seed } from "../../fixtures/collections/collection-entities.ts";
import { ScenarioRunner } from "../../fixtures/collections/scenario-runner.ts";
import { TrackedRoot } from "../../fixtures/collections/tracked-root.ts";

const mongo = MongoLifecycle.useMongo("c_history", BsonOptions.apply({}));

const tags = (r: TrackedRoot) => r.get<StrictArray<string>>("tags");
const revisions = (r: TrackedRoot) => r.get<SubdocumentArray<Revision>>("revisions");
const rev = (r: TrackedRoot, index: number) => revisions(r)[index] as Subdocument<Revision>;

describe("history.yaml regressions (typed collections)", () => {
  test("H005/H417: undefined is never an array element (CastError, not a default or a hole)", async () => {
    const root = await ScenarioRunner.load(mongo);
    expect(() =>
      /* cast: bypasses the type to test the runtime guard — push(undefined) (JS caller) */
      (root.get<StrictArray<number>>("nums") as unknown as { push(v: unknown): void }).push(undefined),
    ).toThrow(CastError);
  });

  test("H024: an empty subdocument pushed into a document array is stored as {_id, array defaults}, not null", async () => {
    const root = await ScenarioRunner.load(mongo);
    revisions(root).push({} as never);
    const docs = mongo.db.collection("c_docs");
    await root.save(docs);
    const raw = await docs.findOne({ _id: IDS.doc });
    const last = ((raw?.revisions ?? []) as Record<string, unknown>[])[3];
    expect(last).not.toBeNull();
    /* an array field without required/default stores [] (tags), so the stored element is {_id, tags: []} */
    expect(Object.keys(last ?? {}).sort()).toEqual(["_id", "tags"]);
  });

  test("H029: arr=[a,b,c]; pull(a); change b (now at 0); save → b is changed in the database, not c", async () => {
    const root = await ScenarioRunner.load(mongo);
    const docs = mongo.db.collection("c_docs");
    revisions(root).pull(rev(root, 0));
    await root.save(docs);
    rev(root, 0).note = "y";
    await root.save(docs);
    const raw = await docs.findOne({ _id: IDS.doc });
    const notes = ((raw?.revisions ?? []) as { note: string }[]).map((value) => value.note);
    expect(notes).toEqual(["y", "n2"]);
  });

  test("H065: a document array inside a Map value → $set m.k.arr.i", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) => void r.get<TypedMap<Subdocument<Badge>>>("badges").get("gold")?.marks?.set(0, 9),
      { $set: { "badges.gold.marks.0": 9 } },
    );
  });

  test("H100: id() casts by the _id type of the element schema (Number)", async () => {
    const root = await ScenarioRunner.load(mongo);
    expect(root.get<SubdocumentArray<{ _id: number; label: string }>>("seats").id(5)?.label).toBe("A5");
  });

  test("H124: push into an array inside a Map → $push m.k", async () => {
    await ScenarioRunner.run(mongo, (r) => void r.get<TypedMap<StrictArray<number>>>("series").get("a")?.push(1), {
      $push: { "series.a": { $each: [1] } },
    });
  });

  test("H204: a failed transaction does not corrupt the arrays' state: restore gives the same ops again", async () => {
    const root = await ScenarioRunner.load(mongo);
    tags(root).replace(["x"]);
    const before = root.ops();
    const snapshots = new Map<string, CollectionSnapshot>(
      Object.entries(root.fields).map(([key, value]) => [key, Collections.snapshot(value)]),
    );
    root.reset();
    for (const [key, value] of Object.entries(root.fields)) {
      Collections.restore(value, snapshots.get(key) ?? { node: undefined });
    }
    expect(root.ops()).toEqual(before);
    expect([...tags(root)]).toEqual(["x"]);
  });

  test("H214: arrays of arrays of subdocuments hold instances of the subdocument class", async () => {
    const root = await ScenarioRunner.load(mongo);
    const grid = root.get<StrictArray<SubdocumentArray<Point>>>("grid");
    expect(grid[0]?.[0]).toBeInstanceOf(Point);
    grid[1]?.push({ x: 5, y: 5 });
    expect(grid[1]?.[0]).toBeInstanceOf(Point);
    expect(root.ops()).toEqual({ $push: { "grid.1": { $each: [{ x: 5, y: 5 }] } } });
  });

  test("H313: after save the nested states are clean — a second save sends nothing", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) => {
        rev(r, 1).note = "x";
        rev(r, 2).tags?.push("y");
      },
      { $set: { "revisions.1.note": "x" }, $push: { "revisions.2.tags": { $each: ["y"] } } },
    );
  });

  test("H322: assigning a nested array of primitives → $set arr.0", async () => {
    await ScenarioRunner.run(mongo, (r) => void r.get<StrictArray<StrictArray<number>>>("matrix").set(0, [1, 2, 3]), {
      $set: { "matrix.0": [1, 2, 3] },
    });
  });

  test("H350: pull() of an element from the middle is $pullAll, not $set of the array", async () => {
    await ScenarioRunner.run(mongo, (r) => void tags(r).pull("b"), { $pullAll: { tags: ["b"] } });
  });

  test("H401: arr[0] = x is not a silent loss — the type forbids it and a cast write is a DirectWriteError", async () => {
    const root = await ScenarioRunner.load(mongo);
    // @ts-expect-error TS2542: the index signature of StrictArray is readonly (use set(0, "x"))
    tags(root)[0] = "x";
    expect(() => root.ops()).toThrow(DirectWriteError);
  });

  test("H409: map/filter/slice return plain arrays, not arrays bound to the document", async () => {
    const root = await ScenarioRunner.load(mongo);
    const mapped = tags(root).map((x) => x);
    expect(Collections.isTracked(mapped)).toBe(false);
    (mapped as string[]).push("free");
    expect(root.hasChanges()).toBe(false);
  });

  test("H428: shift() → $pop -1, not a rewrite of the array", async () => {
    await ScenarioRunner.run(mongo, (r) => void tags(r).shift(), { $pop: { tags: -1 } });
  });

  test("H440: an array assigned to itself after push keeps the change", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) => {
        const r1 = rev(r, 1);
        r1.tags?.push("z");
        if (r1.tags !== undefined) r1.$set("tags", r1.tags);
      },
      { $set: { "revisions.1.tags": ["t1", "z"] } },
    );
  });

  test("H465: arrays longer than 10 000 elements are created and pushed", async () => {
    const docs = mongo.db.collection("c_docs");
    await docs.insertOne({ _id: IDS.doc, nums: Array.from({ length: 20_000 }, () => 1) });
    const root = await TrackedRoot.load(docs, IDS.doc);
    expect(root.get<StrictArray<number>>("nums").length).toBe(20_000);
  });

  test("H481: the input of push/replace/set/Map#set is never mutated", async () => {
    const root = await ScenarioRunner.load(mongo);
    const items = Object.freeze(["p", "q"]);
    tags(root).replace(items);
    tags(root).push(...items);
    const input = Object.freeze({ note: "frozen", lines: 1, tags: Object.freeze(["a"]) });
    revisions(root).push(input);
    rev(root, 3).tags?.push("b");
    expect(input.tags).toEqual(["a"]);
    const badge = Object.freeze({ title: "t", marks: Object.freeze([1]) });
    root.get<TypedMap<Subdocument<Badge>>>("badges").set("new", badge);
    root.get<TypedMap<Subdocument<Badge>>>("badges").get("new")?.marks?.push(2);
    expect(badge.marks).toEqual([1]);
  });

  test("H501: assigning the value it already has sends nothing", async () => {
    const root = await ScenarioRunner.load(mongo);
    rev(root, 0).note = "n0";
    tags(root).set(1, "b");
    root.get<TypedMap<number>>("scores").set("math", 5);
    expect(root.hasChanges()).toBe(false);
  });

  test("H512/H033: an array loaded in part is never overwritten (PartialArrayError)", async () => {
    const root = await ScenarioRunner.load(mongo, ["tags"]);
    tags(root).replace(["only"]);
    expect(() => root.ops()).toThrow(PartialArrayError);
  });

  test("H038/H115 (inside a subdocument): a changed sub-path then the whole field removed → only $unset", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) => {
        rev(r, 1).tags?.push("x");
        delete rev(r, 1).tags;
      },
      { $unset: { "revisions.1.tags": "" } },
    );
  });

  test("seed sanity", () => {
    expect(seed()._id).toEqual(IDS.doc);
  });
});
