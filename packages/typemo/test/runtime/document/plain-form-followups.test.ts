/*
 * Follow-ups of the plain form, on the real server:
 * - the collections (`StrictArray`, `SubdocumentArray`, `TypedMap`, subdocuments) give their OBJECT form through
 *   `$toObject()` (ids stay `ObjectId`, int64 `bigint`); their `$toPlain()` is exactly the document's plain
 *   form at that path.
 * - an int64 in the plain / JSON form (a decimal string) goes back into `create()`, updates and filters.
 * - `Hidden` fields are left out of `$toPlain()` / `.plain()` / `$toJSON()` at every depth (subdocuments, arrays
 *   of subdocuments, Maps of subdocuments, populated documents selected with `+field`) unless `{ hidden: true }`.
 */
import { beforeAll, beforeEach, describe, expect, expectTypeOf, test } from "bun:test";
import { ObjectId } from "mongodb";
import { CastError } from "../../../src/index.ts";
import {
  BIG,
  MAX_LONG,
  type PlainForms,
  type PlainModels,
  plainForms,
  plainModels,
  R21,
  seedPlainForms,
} from "../../fixtures/document/plain-forms.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("r24_r26_forms");
let m: PlainModels;
let ops: PlainForms;

beforeAll(() => {
  m = plainModels(t.connection);
  ops = plainForms(m);
});

beforeEach(async () => {
  await seedPlainForms(t.mongo.db);
});

describe("a collection's own form is $toObject()", () => {
  test("doc.holders.$toObject() keeps the ObjectIds, doc.$toPlain().holders are strings", async () => {
    const doc = await m.All.findById(R21.all).orFail();
    const ids = doc.holders.$toObject();
    expect(ids).toEqual([R21.h1, R21.h2]);
    expect(ids.every((id) => id instanceof ObjectId)).toBe(true);
    expect(doc.$toPlain().holders).toEqual([R21.h1.toHexString(), R21.h2.toHexString()]);
  });

  test("every collection kind: StrictArray, nested arrays, SubdocumentArray, a subdocument, TypedMap", async () => {
    const doc = await m.All.findById(R21.all).orFail();
    expect(doc.grid.$toObject()).toEqual([[1n, MAX_LONG], [-MAX_LONG - 1n]]);
    expect(doc.spots.$toObject()).toEqual([
      { x: 1, weight: BIG },
      { x: 2, marker: R21.marker },
    ]);
    expect(doc.spots[1]?.$toObject()).toEqual({ x: 2, marker: R21.marker });
    expect(doc.spotsByName?.$toObject()).toEqual(new Map([["a", { x: 3, weight: 1n }]]));
    /* the same values in the document's plain form */
    const plain = doc.$toPlain();
    expect(plain.grid).toEqual([["1", "9223372036854775807"], ["-9223372036854775808"]]);
    expect(plain.spots[1]).toEqual({ x: 2, marker: R21.marker.toHexString() });
  });

  test("a collection's $toPlain() is exactly the document's plain form at that path (value and type)", async () => {
    const doc = await m.All.findById(R21.all).orFail();
    const plain = doc.$toPlain();
    const hidden = doc.$toPlain({ hidden: true });
    type Whole = typeof plain;
    const holders = doc.holders.$toPlain();
    const grid = doc.grid.$toPlain();
    const spots = doc.spots.$toPlain();
    const spot = doc.spots[1]?.$toPlain();
    const byName = doc.spotsByName?.$toPlain();
    expectTypeOf(holders).toEqualTypeOf<Whole["holders"]>();
    expectTypeOf(grid).toEqualTypeOf<Whole["grid"]>();
    expectTypeOf(spots).toEqualTypeOf<Whole["spots"]>();
    expectTypeOf(spot).toEqualTypeOf<Whole["spots"][number] | undefined>();
    expectTypeOf(byName).toEqualTypeOf<Whole["spotsByName"]>();
    expect(holders).toEqual(plain.holders);
    expect(holders).toEqual([R21.h1.toHexString(), R21.h2.toHexString()]);
    expect(grid).toEqual(plain.grid);
    expect(spots).toEqual(plain.spots);
    expect(spot).toEqual(plain.spots[1]);
    expect(byName).toEqual(plain.spotsByName);
    expect(byName).toBeInstanceOf(Map);
    /* the options: Hidden fields of subdocuments only when asked, as in the document's form */
    expect(doc.spots.$toPlain({ hidden: true })).toEqual(hidden.spots);
    expect(doc.spotsByName?.$toPlain({ hidden: true })).toEqual(hidden.spotsByName);
    /* nothing aliases the collection; JSON.stringify never meets a bigint */
    expect(() => JSON.stringify(grid)).not.toThrow();
    expect(doc.holders.$toObject()[0]).toBeInstanceOf(ObjectId);
  });
});

describe("an int64 of the plain / JSON form goes back in", () => {
  test("$toJSON() / $toPlain() of int64 beyond 2^53 → create() → the same value in the database", async () => {
    const boss = await m.Holders.findById(R21.boss).orFail();
    const json = boss.$toJSON();
    const plain = boss.$toPlain();
    expect(json.score).toBe("9223372036854775807");
    expect(plain.score).toBe("9223372036854775807");
    const fromJson = await m.Holders.create({ name: "from-json", score: json.score ?? "0" });
    const fromPlain = await m.Holders.create({ name: "from-plain", score: plain.score ?? "0" });
    expect(fromJson.score).toBe(MAX_LONG);
    const raw = t.mongo.db.collection("r21_holders");
    const stored = await raw.find({ name: { $in: ["from-json", "from-plain"] } }, { sort: { name: 1 } }).toArray();
    expect(stored.map((row) => row.score)).toEqual([MAX_LONG, MAX_LONG]);
    expect(await raw.countDocuments({ _id: fromPlain._id, score: { $type: "long" } })).toBe(1);
  });

  test("the smallest int64 and a value just beyond 2^53 survive the round trip", async () => {
    const created = await m.Holders.create({ name: "edges", score: "-9223372036854775808" });
    expect(created.score).toBe(-MAX_LONG - 1n);
    await m.Holders.updateOne({ _id: created._id }, { $set: { score: "9007199254740993" } });
    const row = await t.mongo.db.collection("r21_holders").findOne({ _id: created._id });
    expect(row?.score).toBe(BIG);
  });

  test("a filter takes the decimal string (cast to int64 on the way)", async () => {
    const found = await m.Holders.find({ score: "9223372036854775807" }).lean();
    expect(found.map((row) => row.name)).toEqual(["boss"]);
    const ranged = await m.Holders.find({ score: { $gt: "9007199254740993" } }).lean();
    expect(ranged.map((row) => row.name)).toEqual(["boss"]);
  });

  test("anything but a strict decimal int64 string is a CastError, nothing is written", async () => {
    /* cast: bypasses the input type — a JS caller or unchecked request data */
    const bad = ["1.5", "1e3", " 1", "+1", "0x10", "01", "", "-0", "9223372036854775808", "-9223372036854775809"];
    for (const score of bad) {
      const error = await m.Holders.create({ name: "bad", score: score as `${bigint}` }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CastError);
    }
    expect(await t.mongo.db.collection("r21_holders").countDocuments({ name: "bad" })).toBe(0);
  });
});

describe("Hidden fields out of the plain and JSON forms at every depth", () => {
  test("$toPlain(): selected Hidden fields of a subdocument, array elements and the populated keeper are out", async () => {
    const doc = await ops.vaultToPlain();
    expect(doc.main).toEqual({ label: "main" });
    expect(doc.lockers).toEqual([{ label: "l0" }, { label: "l1" }]);
    expect(doc.byRoom).toEqual(new Map([["hall", { label: "hall" }]]));
    expect(doc.keeper).not.toHaveProperty("pin");
  });

  test("{ hidden: true }: every loaded Hidden field is in", async () => {
    const doc = await ops.vaultToPlainHidden();
    expect(doc.main).toEqual({ label: "main", code: "c-main" });
    expect(doc.lockers).toEqual([
      { label: "l0", code: "c-l0" },
      { label: "l1", code: "c-l1" },
    ]);
    expect(doc.byRoom).toEqual(new Map([["hall", { label: "hall", code: "c-hall" }]]));
    expect(doc.keeper).toHaveProperty("pin", "p1");
  });

  test(".plain() and $toJSON() follow the same rule", async () => {
    const plain = await ops.vaultPlain();
    expect(plain.main).toEqual({ label: "main" });
    expect(plain.lockers).toEqual([{ label: "l0" }, { label: "l1" }]);
    expect(plain.keeper).not.toHaveProperty("pin");
    const plainHidden = await ops.vaultPlainHidden();
    expect(plainHidden.main).toEqual({ label: "main", code: "c-main" });
    expect(plainHidden.keeper).toHaveProperty("pin", "p1");
    const json = await ops.vaultToJson();
    expect(json.main).toEqual({ label: "main" });
    expect(json.byRoom).toEqual({ hall: { label: "hall" } });
    expect(json.keeper).not.toHaveProperty("pin");
    const jsonHidden = await ops.vaultToJsonHidden();
    expect(jsonHidden.lockers).toEqual([
      { label: "l0", code: "c-l0" },
      { label: "l1", code: "c-l1" },
    ]);
    expect(jsonHidden.keeper).toHaveProperty("pin", "p1");
  });

  test("$toObject(): Hidden fields in by default, out at every depth with { hidden: false }", async () => {
    const object = await ops.vaultToObject();
    expect(object.main).toEqual({ label: "main", code: "c-main" });
    expect(object.keeper).toHaveProperty("pin", "p1");
    const without = await ops.vaultToObjectNoHidden();
    expect(without.main).toEqual({ label: "main" });
    expect(without.lockers).toEqual([{ label: "l0" }, { label: "l1" }]);
    expect(without.byRoom).toEqual(new Map([["hall", { label: "hall" }]]));
    expect(without.keeper).not.toHaveProperty("pin");
  });
});
