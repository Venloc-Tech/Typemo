/*
 * TypedMap — keys checked, values cast with errors THROWN (Mongoose
 * swallowed them), a journal per key → `$set`/`$unset` of `map.key`.
 */
import { describe, expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import {
  BsonOptions,
  CastError,
  DirectWriteError,
  type StrictArray,
  type Subdocument,
  type TypedMap,
} from "../../../src/index.ts";
import type { Badge } from "../../fixtures/collections/collection-entities.ts";
import { ScenarioRunner } from "../../fixtures/collections/scenario-runner.ts";
import type { TrackedRoot } from "../../fixtures/collections/tracked-root.ts";

const mongo = MongoLifecycle.useMongo("c_maps", BsonOptions.apply({}));

/**
 * The `scores` map of a tracked root.
 * @param r The tracked root.
 * @returns The map of numbers.
 */
const scores = (r: TrackedRoot) => r.get<TypedMap<number>>("scores");
/**
 * The `badges` map of a tracked root.
 * @param r The tracked root.
 * @returns The map of badge subdocuments.
 */
const badges = (r: TrackedRoot) => r.get<TypedMap<Subdocument<Badge>>>("badges");
/**
 * The `series` map of a tracked root.
 * @param r The tracked root.
 * @returns The map of arrays of numbers.
 */
const series = (r: TrackedRoot) => r.get<TypedMap<StrictArray<number>>>("series");

describe("TypedMap: journal → ops", () => {
  test("set → $set map.key", async () => {
    await ScenarioRunner.run(mongo, (r) => void scores(r).set("music", 4), { $set: { "scores.music": 4 } });
  });

  test("delete → $unset map.key", async () => {
    await ScenarioRunner.run(mongo, (r) => void scores(r).delete("art"), { $unset: { "scores.art": "" } });
  });

  test("set + delete of different keys in one save", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) => {
        scores(r).set("math", 6);
        scores(r).delete("art");
      },
      { $set: { "scores.math": 6 }, $unset: { "scores.art": "" } },
    );
  });

  test("set then delete the same key → only $unset; delete then set → only $set", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) => {
        scores(r).set("art", 9);
        scores(r).delete("art");
        scores(r).delete("math");
        scores(r).set("math", 1);
      },
      { $set: { "scores.math": 1 }, $unset: { "scores.art": "" } },
    );
  });

  test("clear → $set map {} (then set → still the whole map)", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) => {
        scores(r).clear();
        scores(r).set("x", 1);
      },
      { $set: { scores: { x: 1 } } },
    );
  });

  test("a field of a subdocument value → $set badges.gold.title", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) => {
        const gold = badges(r).get("gold");
        if (gold) gold.title = "GOLD";
        expect(gold?.$fullPath()).toBe("badges.gold");
      },
      { $set: { "badges.gold.title": "GOLD" } },
    );
  });

  test("set of a subdocument value from plain input", async () => {
    await ScenarioRunner.run(mongo, (r) => void badges(r).set("silver", { title: "Silver" }), {
      $set: { "badges.silver": { title: "Silver", marks: [] } },
    });
  });

  test("push into an array value of a Map → $push series.a", async () => {
    await ScenarioRunner.run(mongo, (r) => void series(r).get("a")?.push(3), { $push: { "series.a": { $each: [3] } } });
  });

  test("a set value may come as plain data; the value is cast (a new tracked array)", async () => {
    await ScenarioRunner.run(mongo, (r) => void series(r).set("b", [7]), { $set: { "series.b": [7] } });
  });

  test("delete of an absent key and clear of an empty map record nothing", async () => {
    const root = await ScenarioRunner.load(mongo);
    expect(scores(root).delete("nope")).toBe(false);
    expect(root.hasChanges()).toBe(false);
  });
});

describe("TypedMap: keys and values are checked at once", () => {
  test.each([
    ["a.b", /cannot contain "\."/],
    ["$x", /cannot start with "\$"/],
    ["__proto__", /__proto__/],
    ["", /empty key/],
  ])("key %p → CastError (reason key)", async (key, message) => {
    const root = await ScenarioRunner.load(mongo);
    let caught: unknown;
    try {
      scores(root).set(key, 1);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CastError);
    expect((caught as CastError).reason).toBe("key");
    expect((caught as CastError).message).toMatch(message);
    expect(root.hasChanges()).toBe(false);
  });

  test("a value of the wrong type is thrown, never swallowed", async () => {
    const root = await ScenarioRunner.load(mongo);
    /* cast: bypasses the type to test the runtime guard — set() of an undefined / wrong value (JS caller) */
    const untyped = scores(root) as unknown as { set(k: string, v: unknown): void };
    expect(() => untyped.set("x", "five")).toThrow(CastError);
    expect(() => untyped.set("x", undefined)).toThrow(/undefined is never a value/);
    /* cast: bypasses the type to test the runtime guard — set() of a wrong value (JS caller) */
    const badgeMap = badges(root) as unknown as { set(k: string, v: unknown): void };
    expect(() => badgeMap.set("x", { title: 1 })).toThrow(/badges\.x\.title/);
    expect(scores(root).has("x")).toBe(false);
  });
});

describe("TypedMap: plain forms", () => {
  test("$toObject gives a native Map; reading works as a Map", async () => {
    const root = await ScenarioRunner.load(mongo);
    const map = scores(root);
    expect(map).toBeInstanceOf(Map);
    expect(map.get("math")).toBe(5);
    expect([...map.keys()]).toEqual(["math", "art"]);
    const plain = map.$toObject();
    expect(plain.constructor).toBe(Map);
    plain.set("mutating", 1);
    expect(root.hasChanges()).toBe(false);
    expect(structuredClone(map) as unknown).toEqual(
      new Map([
        ["math", 5],
        ["art", 3],
      ]),
    );
  });

  test("a direct Map.prototype.set around the method → DirectWriteError at save", async () => {
    const root = await ScenarioRunner.load(mongo);
    Map.prototype.set.call(scores(root), "math", 100);
    expect(root.hasChanges()).toBe(true);
    expect(() => root.ops()).toThrow(DirectWriteError);
  });
});
