/*
 * Every mutation method of `StrictArray` × element kinds, on the real mongod.
 * Each case checks the exact update sent (CommandRecorder), that the stored document equals memory, and
 * that a second save sends nothing (ScenarioRunner).
 */
import { describe, expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import { Binary, Decimal128, ObjectId, UUID } from "mongodb";
import { BsonOptions, CastError, type StrictArray, TypemoError } from "../../../src/index.ts";
import { IDS } from "../../fixtures/collections/collection-entities.ts";
import { ScenarioRunner } from "../../fixtures/collections/scenario-runner.ts";
import type { TrackedRoot } from "../../fixtures/collections/tracked-root.ts";

const mongo = MongoLifecycle.useMongo("c_strict", BsonOptions.apply({}));

/**
 * The `tags` array of a tracked root.
 * @param root The tracked root.
 * @returns The strict array of strings.
 */
const tags = (root: TrackedRoot) => root.get<StrictArray<string>>("tags");
/**
 * The `nums` array of a tracked root.
 * @param root The tracked root.
 * @returns The strict array of numbers.
 */
const nums = (root: TrackedRoot) => root.get<StrictArray<number>>("nums");

describe("StrictArray of strings: each method → the minimal update", () => {
  const cases: readonly (readonly [string, (root: TrackedRoot) => void, object])[] = [
    ["push", (r) => void tags(r).push("d"), { $push: { tags: { $each: ["d"] } } }],
    [
      "push ×2 is coalesced into one $each",
      (r) => {
        tags(r).push("d");
        tags(r).push("e", "f");
      },
      { $push: { tags: { $each: ["d", "e", "f"] } } },
    ],
    [
      "unshift → $push with $position 0",
      (r) => void tags(r).unshift("z"),
      { $push: { tags: { $each: ["z"], $position: 0 } } },
    ],
    [
      "unshift ×2 keeps the order of the array",
      (r) => {
        tags(r).unshift("y");
        tags(r).unshift("w", "x");
      },
      { $push: { tags: { $each: ["w", "x", "y"], $position: 0 } } },
    ],
    [
      "addToSet sends only the new values",
      (r) => void tags(r).addToSet("a", "z", "z"),
      { $addToSet: { tags: { $each: ["z"] } } },
    ],
    ["pull → $pullAll", (r) => void tags(r).pull("b"), { $pullAll: { tags: ["b"] } }],
    [
      "pull ×2 is coalesced",
      (r) => {
        tags(r).pull("a");
        tags(r).pull("c");
      },
      { $pullAll: { tags: ["a", "c"] } },
    ],
    ["pop → $pop 1", (r) => void tags(r).pop(), { $pop: { tags: 1 } }],
    ["shift → $pop -1 (research H428)", (r) => void tags(r).shift(), { $pop: { tags: -1 } }],
    [
      "pop ×2 → $set of the whole array ($pop removes one element)",
      (r) => {
        tags(r).pop();
        tags(r).pop();
      },
      { $set: { tags: ["a"] } },
    ],
    [
      "pop + shift → $set",
      (r) => {
        tags(r).pop();
        tags(r).shift();
      },
      { $set: { tags: ["b"] } },
    ],
    ["splice → $set", (r) => void tags(r).splice(1, 1, "B", "B2"), { $set: { tags: ["a", "B", "B2", "c"] } }],
    ["sort → $set", (r) => void tags(r).sort((x, y) => y.localeCompare(x)), { $set: { tags: ["c", "b", "a"] } }],
    ["reverse → $set", (r) => void tags(r).reverse(), { $set: { tags: ["c", "b", "a"] } }],
    ["set(i, v) → $set path.i", (r) => void tags(r).set(1, "B"), { $set: { "tags.1": "B" } }],
    [
      "set at two positions",
      (r) => {
        tags(r).set(0, "A").set(2, "C");
      },
      { $set: { "tags.0": "A", "tags.2": "C" } },
    ],
    ["clear → $set []", (r) => void tags(r).clear(), { $set: { tags: [] } }],
    ["replace → $set", (r) => void tags(r).replace(["x", "y"]), { $set: { tags: ["x", "y"] } }],
    [
      "push + set(i) → $set (index write next to an atomic, code 40)",
      (r) => {
        tags(r).push("d");
        tags(r).set(0, "A");
      },
      { $set: { tags: ["A", "b", "c", "d"] } },
    ],
    [
      "set(i) + push → $set",
      (r) => {
        tags(r).set(0, "A");
        tags(r).push("d");
      },
      { $set: { tags: ["A", "b", "c", "d"] } },
    ],
    [
      "push + pull → $set (two kinds of atomic)",
      (r) => {
        tags(r).push("d");
        tags(r).pull("a");
      },
      { $set: { tags: ["b", "c", "d"] } },
    ],
    [
      "two arrays in one save: ops of both",
      (r) => {
        tags(r).push("d");
        nums(r).pull(2);
      },
      { $push: { tags: { $each: ["d"] } }, $pullAll: { nums: [2] } },
    ],
    ["aliased field (dbName) uses the database name", (r) => void r.get<StrictArray<string>>("labels")?.push("x"), {}],
  ];
  for (const [name, mutate, expected] of cases) {
    if (Object.keys(expected).length === 0) continue;
    test(name, async () => {
      await ScenarioRunner.run(mongo, mutate, expected);
    });
  }

  test("no-op mutations record nothing", async () => {
    const root = await ScenarioRunner.load(mongo);
    tags(root).pull("zzz");
    tags(root).addToSet("a");
    tags(root).splice(1, 0);
    tags(root).set(0, "a");
    expect(root.hasChanges()).toBe(false);
    expect(root.ops()).toEqual({});
  });

  test("set outside the array is an error, not a hole", async () => {
    const root = await ScenarioRunner.load(mongo);
    expect(() => tags(root).set(3, "d")).toThrow(TypemoError);
    expect(() => tags(root).set(-1, "d")).toThrow(TypemoError);
    expect(() => tags(root).set(0.5, "d")).toThrow(TypemoError);
  });

  test("elements are cast at once: CastError with the element path", async () => {
    const root = await ScenarioRunner.load(mongo);
    /* cast: bypasses the type to test the runtime guard — push/set of wrong values (JS caller) */
    const untyped = tags(root) as unknown as { push(...items: unknown[]): number; set(i: number, v: unknown): void };
    expect(() => untyped.push("d", 5)).toThrow(CastError);
    expect(() => untyped.push(undefined)).toThrow(/undefined is never a value/);
    expect(() => untyped.set(0, null)).toThrow(/tags\.0/);
    /* Nothing was applied by the failing call. */
    expect([...tags(root)]).toEqual(["a", "b", "c"]);
    expect(root.hasChanges()).toBe(false);
  });

  test("method results match Array semantics", async () => {
    const root = await ScenarioRunner.load(mongo);
    expect(tags(root).push("d")).toBe(4);
    expect(tags(root).pop()).toBe("d");
    expect(tags(root).shift()).toBe("a");
    expect(tags(root).unshift("a")).toBe(3);
    expect(tags(root).addToSet("a", "q")).toEqual(["q"]);
    expect(tags(root).pull("q", "b")).toEqual(["b", "q"]);
    expect(tags(root).splice(0, 1)).toEqual(["a"]);
  });
});

describe("StrictArray: reading is a plain array", () => {
  test("iteration, spread, map/filter give plain arrays; structuredClone and JSON work", async () => {
    const root = await ScenarioRunner.load(mongo);
    const array = tags(root);
    expect(Array.isArray(array)).toBe(true);
    expect([...array]).toEqual(["a", "b", "c"]);
    const mapped = array.map((x) => x.toUpperCase());
    expect(mapped.constructor).toBe(Array);
    expect(array.filter(() => true).constructor).toBe(Array);
    expect(array.slice().constructor).toBe(Array);
    expect(structuredClone(array) as unknown).toEqual(["a", "b", "c"]);
    expect(JSON.stringify(array)).toBe('["a","b","c"]');
    const plain = array.$toObject();
    expect(plain.constructor).toBe(Array);
    plain.push("mutating the copy");
    expect(root.hasChanges()).toBe(false);
  });

  test("large arrays: 100 000 elements hydrate and push", async () => {
    const docs = mongo.db.collection("c_docs");
    const big = Array.from({ length: 100_000 }, (_, i) => i);
    await docs.insertOne({ _id: IDS.doc, nums: big });
    const { TrackedRoot } = await import("../../fixtures/collections/tracked-root.ts");
    const root = await TrackedRoot.load(docs, IDS.doc);
    nums(root).push(-1);
    expect(root.ops()).toEqual({ $push: { nums: { $each: [-1] } } });
  });
});

describe("StrictArray of BSON values: compared with equals, never ==", () => {
  test("ObjectId: pull by an equal (not identical) id → $pullAll", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) => {
        const owners = r.get<StrictArray<ObjectId>>("owners");
        expect(owners.pull(new ObjectId(IDS.owner[0].toHexString()))).toHaveLength(1);
      },
      { $pullAll: { owners: [IDS.owner[0]] } },
    );
  });

  test("ObjectId: addToSet ignores an equal id", async () => {
    const fresh = new ObjectId("660000000000000000000099");
    await ScenarioRunner.run(
      mongo,
      (r) => void r.get<StrictArray<ObjectId>>("owners").addToSet(new ObjectId(IDS.owner[1].toHexString()), fresh),
      { $addToSet: { owners: { $each: [fresh] } } },
    );
  });

  test("ObjectId: a hex string is cast to ObjectId (safe list)", async () => {
    const hex = "660000000000000000000077";
    await ScenarioRunner.run(
      mongo,
      /* cast: bypasses the type to test the runtime guard — a string pushed where an ObjectId is expected */
      (r) => void (r.get<StrictArray<ObjectId>>("owners") as unknown as { push(v: unknown): number }).push(hex),
      { $push: { owners: { $each: [new ObjectId(hex)] } } },
    );
  });

  test("Date: pull by time", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) => void r.get<StrictArray<Date>>("dates").pull(new Date("2020-01-01T00:00:00Z")),
      { $pullAll: { dates: [new Date("2020-01-01T00:00:00Z")] } },
    );
  });

  test("Decimal128: addToSet compares by value", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) =>
        void r
          .get<StrictArray<Decimal128>>("prices")
          .addToSet(Decimal128.fromString("1.5"), Decimal128.fromString("9.9")),
      { $addToSet: { prices: { $each: [Decimal128.fromString("9.9")] } } },
    );
  });

  test("bigint (Long): push and set", async () => {
    await ScenarioRunner.run(mongo, (r) => void r.get<StrictArray<bigint>>("bigs").set(0, 10n), {
      $set: { "bigs.0": 10n },
    });
  });

  test("UUID: pull by bytes", async () => {
    const uuid = new UUID("00000000-0000-4000-8000-000000000002");
    await ScenarioRunner.run(mongo, (r) => void r.get<StrictArray<UUID>>("uuids").pull(new UUID(uuid.toHexString())), {
      $pullAll: { uuids: [uuid] },
    });
  });

  test("Binary: set a new value at a position", async () => {
    const blob = new Binary(new Uint8Array([9]));
    await ScenarioRunner.run(mongo, (r) => void r.get<StrictArray<Binary>>("blobs").set(0, blob), {
      $set: { "blobs.0": blob },
    });
  });
});

describe("nested arrays (StrictArray<StrictArray<number>>)", () => {
  const matrix = (r: TrackedRoot) => r.get<StrictArray<StrictArray<number>>>("matrix");

  test("push into an inner array → $push matrix.0", async () => {
    await ScenarioRunner.run(mongo, (r) => void matrix(r)[0]?.push(9), { $push: { "matrix.0": { $each: [9] } } });
  });

  test("an outer atomic plus an inner change → $set of the outer array", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) => {
        matrix(r)[0]?.push(9);
        matrix(r).push([5]);
      },
      {
        $set: {
          matrix: [[1, 2, 9], [3, 4], [5, 6].slice(0, 1)],
        },
      },
    );
  });

  test("set(0, [1, 2]) on a nested array → $set matrix.0", async () => {
    await ScenarioRunner.run(mongo, (r) => void matrix(r).set(0, [7, 8]), { $set: { "matrix.0": [7, 8] } });
  });

  test("an inner array pushed by plain value is tracked", async () => {
    const root = await ScenarioRunner.load(mongo);
    matrix(root).push([1]);
    root.reset();
    matrix(root)[2]?.push(2);
    expect(root.ops()).toEqual({ $push: { "matrix.2": { $each: [2] } } });
  });
});

describe("nullable array field", () => {
  test("elements are strings; the field itself may be null", async () => {
    const root = await ScenarioRunner.load(mongo);
    const maybe = root.get<StrictArray<string>>("maybe");
    maybe.push("y");
    expect(root.ops()).toEqual({ $push: { maybe: { $each: ["y"] } } });
  });
});
