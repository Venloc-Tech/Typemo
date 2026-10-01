/*
 * Single subdocuments and nested objects (`@Schema({ nested: true })`):
 * field changes → `$set path.field`, `$set(key, value)` casts at once and replaces, parent links.
 */
import { describe, expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import { ObjectId } from "mongodb";
import { BsonOptions, CastError, DirectWriteError, type Subdocument, type TypedMap } from "../../../src/index.ts";
import { Address, type Badge, type FullName, IDS } from "../../fixtures/collections/collection-entities.ts";
import { ScenarioRunner } from "../../fixtures/collections/scenario-runner.ts";
import type { TrackedRoot } from "../../fixtures/collections/tracked-root.ts";

const mongo = MongoLifecycle.useMongo("c_single", BsonOptions.apply({}));

/**
 * The `address` subdocument of a tracked root.
 * @param r The tracked root.
 * @returns The address subdocument.
 */
const address = (r: TrackedRoot) => r.get<Subdocument<Address>>("address");
/**
 * The `fullName` nested object of a tracked root.
 * @param r The tracked root.
 * @returns The full name subdocument.
 */
const fullName = (r: TrackedRoot) => r.get<Subdocument<FullName>>("fullName");

describe("single subdocument", () => {
  test("is an instance of its class, linked to the root", async () => {
    const root = await ScenarioRunner.load(mongo);
    expect(address(root)).toBeInstanceOf(Address);
    expect(address(root).$fullPath()).toBe("address");
    expect(address(root).$parent()).toBe(root.fields);
    expect(address(root).$parentArray()).toBeUndefined();
    expect(address(root).$index()).toBe(-1);
  });

  test("a field change → $set address.city", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) => {
        address(r).city = "Bergen";
      },
      { $set: { "address.city": "Bergen" } },
    );
  });

  test("an array inside → $push address.lines", async () => {
    await ScenarioRunner.run(mongo, (r) => void address(r).lines?.push("street 2"), {
      $push: { "address.lines": { $each: ["street 2"] } },
    });
  });

  test("$set(key, value) casts at once and replaces a container field → $set address.lines", async () => {
    await ScenarioRunner.run(mongo, (r) => void address(r).$set("lines", ["new"]), {
      $set: { "address.lines": ["new"] },
    });
  });

  test("$set of a wrong value or an unknown key → CastError, nothing changed", async () => {
    const root = await ScenarioRunner.load(mongo);
    /* cast: bypasses the type to test the runtime guard — $set of an unknown key / wrong value (JS caller) */
    const untyped = address(root) as unknown as { $set(k: string, v: unknown): void };
    expect(() => untyped.$set("city", 5)).toThrow(CastError);
    expect(() => untyped.$set("nope", 5)).toThrow(/nope" for 5 \(number\): not a field of Address/);
    expect(() => untyped.$set("city", undefined)).toThrow(/undefined/);
    expect(root.hasChanges()).toBe(false);
  });

  test("a container field replaced around $set (cast/JS) → DirectWriteError at save", async () => {
    const root = await ScenarioRunner.load(mongo);
    /* cast: bypasses the type to test the runtime guard — a container field assigned directly */
    (address(root) as unknown as { lines: string[] }).lines = ["plain"];
    expect(() => root.ops()).toThrow(DirectWriteError);
  });

  test("the same value assigned again is not a change", async () => {
    const root = await ScenarioRunner.load(mongo);
    const current = address(root).city;
    address(root).city = `${current}`;
    address(root)._id = new ObjectId(IDS.address.toHexString());
    expect(root.hasChanges()).toBe(false);
  });
});

describe("nested object (@Schema({ nested: true })): no _id, same tracking", () => {
  test("a field change → $set fullName.first", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) => {
        fullName(r).first = "Anna";
      },
      { $set: { "fullName.first": "Anna" } },
    );
  });

  test("a deleted optional field → $unset fullName.last", async () => {
    await ScenarioRunner.run(mongo, (r) => void delete fullName(r).last, { $unset: { "fullName.last": "" } });
  });

  test("an optional field assigned `undefined` (without exactOptionalPropertyTypes) is absent → $unset", async () => {
    await ScenarioRunner.run(
      mongo,
      (r) => {
        (fullName(r) as { last?: string | undefined }).last = undefined;
      },
      {
        $unset: { "fullName.last": "" },
      },
    );
  });

  test("has no _id and plain data only", async () => {
    const root = await ScenarioRunner.load(mongo);
    expect(Object.keys(fullName(root))).toEqual(["first", "last"]);
    expect(fullName(root).$toObject()).toEqual({ first: "Ann", last: "Lee" });
  });
});

describe("a scalar assigned directly is cast once, at the save that sends it", () => {
  test("transforms of the caster (lowercase) apply once and are written back", async () => {
    const root = await ScenarioRunner.load(mongo);
    const badges = root.get<TypedMap<Subdocument<Badge>>>("badges");
    const gold = badges.get("gold");
    if (gold === undefined) throw new Error("seed");
    gold.code = "ABC";
    expect(root.ops()).toEqual({ $set: { "badges.gold.code": "abc" } });
    expect(gold.code).toBe("abc");
    expect(root.ops("code")).toEqual({ $set: { "badges.gold.code": "abc" } });
  });

  test("a wrong type assigned around the type → CastError at save, with the path", async () => {
    const root = await ScenarioRunner.load(mongo);
    /* cast: bypasses the type to test the runtime guard — a scalar of the wrong type assigned (JS caller) */
    (address(root) as unknown as { city: unknown }).city = 5;
    let caught: unknown;
    try {
      root.ops();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CastError);
    expect((caught as CastError).path).toBe("address.city");
  });

  test("values read from the database and set by $set are not cast again", async () => {
    const root = await ScenarioRunner.load(mongo);
    address(root).$set("city", "Bergen");
    expect(root.ops()).toEqual({ $set: { "address.city": "Bergen" } });
  });
});
