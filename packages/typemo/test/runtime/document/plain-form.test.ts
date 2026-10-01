/*
 * On the real server: the plain form — `doc.$toPlain(options)` of a hydrated document and `.plain()` of
 * queries, cursors and aggregations (no hydration). Every BSON type in every form of the same stored document (the
 * raw driver wrote it): hydrated → `$toPlain()` / `$toObject()` / `$toJSON()`, and the reads `.plain()` / `.lean()`;
 * int64 beyond 2^53 and ±2^63, the three vector dtypes (packed bits with padding), `null` against a missing field,
 * nested arrays, subdocuments, a Map of subdocuments, `Hidden` fields with and without the option, a getter virtual,
 * populate on two levels (a populated document walked by its own schema), arrays, Maps and virtuals of references,
 * a transform, a root discriminator. The JSON regressions (int64 → string, vector → number[]) are here too.
 */
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { z } from "@venloc/typemo-test-kit";
import { Binary, Decimal128, ObjectId, Timestamp } from "mongodb";
import { Entity, type OperationHookContext, Post, Prop, QueryError, Schema, Types } from "../../../src/index.ts";
import { AllForms } from "../../fixtures/document/plain-entities.ts";
import {
  BIG,
  BITS,
  MAX_LONG,
  type PlainForms,
  type PlainModels,
  plainForms,
  plainModels,
  R21,
  seedPlainForms,
} from "../../fixtures/document/plain-forms.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("r21_plain");
let m: PlainModels;
let ops: PlainForms;

beforeAll(() => {
  m = plainModels(t.connection);
  ops = plainForms(m);
});

beforeEach(async () => {
  await seedPlainForms(t.mongo.db);
});

/**
 * The plain form of the seeded `AllForms` document (`Hidden` field out).
 * @returns The expected plain object.
 */
const expectedPlain = () => ({
  _id: R21.all.toHexString(),
  str: "all",
  num: 1.5,
  i32: 42,
  long: "9007199254740993" as const,
  dec: "19.99",
  bool: true,
  date: new Date("2026-09-28T10:00:00.000Z"),
  bin: new Uint8Array([1, 2, 3]),
  uuid: "0f8fad5b-d9cb-469f-a165-70867728950e",
  vInt8: [-128, 0, 127],
  vFloat32: [0.5, -2.25],
  vBits: BITS,
  re: /a.b/i,
  ts: { t: 1_700_000_000, i: 7 },
  nil: null,
  grid: [["1", "9223372036854775807"], ["-9223372036854775808"]] satisfies `${bigint}`[][],
  spots: [
    { x: 1, weight: "9007199254740993" as const },
    { x: 2, marker: R21.marker.toHexString() },
  ],
  spotsByName: new Map([["a", { x: 3, weight: "1" as const }]]),
  prices: new Map([["p", "0.10"]]),
  owner: R21.h1.toHexString(),
  holders: [R21.h1.toHexString(), R21.h2.toHexString()],
  holdersByRole: new Map([["lead", R21.h1.toHexString()]]),
});

describe("$toPlain() of a hydrated document", () => {
  test("every BSON type in its plain form; null kept, a missing field absent; Hidden out by default", async () => {
    const plain = await ops.toPlain();
    expect(plain).toEqual(expectedPlain());
    expect(plain.nil).toBeNull();
    expect("missing" in plain).toBe(false);
    expect("secret" in plain).toBe(false);
    /* the native types are the platform's own: a Map, a Date, a RegExp, a Uint8Array (never a Buffer) */
    expect(plain.spotsByName).toBeInstanceOf(Map);
    expect(Object.getPrototypeOf(plain.bin)).toBe(Uint8Array.prototype);
    expect(plain.date).toBeInstanceOf(Date);
  });

  test("{ hidden: true } keeps the loaded Hidden field; { virtuals: true } adds the getter virtual", async () => {
    expect(await ops.toPlainHidden()).toEqual({ ...expectedPlain(), secret: "s3cret" });
    const withVirtuals = await ops.toPlainVirtuals();
    expect(withVirtuals.summary).toBe("all:9007199254740993");
  });

  test("nothing aliases the document: changing the result leaves the document as it was", async () => {
    const doc = await m.All.findById(R21.all).orFail();
    const plain = doc.$toPlain();
    plain.date?.setUTCFullYear(2000);
    plain.bin?.fill(0);
    plain.spotsByName?.set("b", { x: 9 });
    expect(doc.date?.getUTCFullYear()).toBe(2026);
    expect([...(doc.bin?.buffer.subarray(0, 3) ?? [])]).toEqual([1, 2, 3]);
    expect(doc.spotsByName?.has("b")).toBe(false);
    expect(doc.$isModified()).toBe(false);
  });

  test("JSON.stringify of the plain form never meets a bigint (int64 values are strings)", async () => {
    const plain = await ops.toPlain();
    const text = JSON.stringify(plain);
    expect(JSON.parse(text).long).toBe("9007199254740993");
    expect(JSON.parse(text).grid).toEqual([["1", `${MAX_LONG}` as const], [`${-MAX_LONG - 1n}` as const]]);
  });

  test("the plain form never leaks into what save writes (ids, int64 and Maps stay BSON in the database)", async () => {
    const doc = await m.All.findById(R21.all).orFail();
    doc.$toPlain({ hidden: true, virtuals: true });
    doc.str = "changed";
    await doc.$save();
    const stored = await t.mongo.db.collection("r21_all_forms").findOne({ _id: R21.all });
    expect(stored?._id).toBeInstanceOf(ObjectId);
    expect(stored?.owner).toBeInstanceOf(ObjectId);
    expect(stored?.long).toBe(BIG);
    expect(stored?.vBits).toBeInstanceOf(Binary);
    expect(stored?.str).toBe("changed");
  });

  test("a final transform: its result is the result", async () => {
    const doc = await m.All.findById(R21.all).orFail();
    expect(doc.$toPlain({ transform: (plain) => plain.long })).toBe("9007199254740993");
  });
});

describe(".plain() of queries: the plain form without hydration", () => {
  test("findById().plain() equals $toPlain() of the hydrated document; not an instance of the class", async () => {
    const plain = await ops.plain();
    expect(plain).toEqual(expectedPlain());
    expect(plain).toEqual(await ops.toPlain());
    expect(plain).not.toBeInstanceOf(AllForms);
    expect(Object.getPrototypeOf(plain)).toBe(Object.prototype);
  });

  test("Hidden: selected with +secret, still out unless .plain({ hidden: true })", async () => {
    expect("secret" in (await ops.plain())).toBe(false);
    expect((await ops.plainHidden()).secret).toBe("s3cret");
    expect(await ops.plainHidden()).toEqual(await ops.toPlainHidden());
  });

  test("populate on two levels: the populated documents are plain too, walked by their own schema", async () => {
    const plain = await ops.plainPopulated();
    expect(plain).toEqual(await ops.toPlainPopulated());
    expect(plain.owner?.boss).toEqual({
      _id: R21.boss.toHexString(),
      name: "boss",
      score: `${MAX_LONG}` as const,
      /* the populated document's Map of subdocuments is a Map (its schema says so), its int64 a string */
      spots: new Map([["home", { x: 1, weight: `${BIG}` as const }]]),
    });
    expect(plain.holders.map((holder) => holder.name)).toEqual(["h1", "h2"]);
    expect(plain.holdersByRole?.get("lead")).toEqual({ _id: R21.h1.toHexString(), name: "h1" });
  });

  test("Hidden in a populated document: out by default, in with { hidden: true }", async () => {
    expect(await ops.plainPopulated()).not.toHaveProperty("owner.boss.pin");
    expect((await ops.plainPopulatedHidden()).owner?.boss).toHaveProperty("pin", "p0");
  });

  test("a populate virtual: plain documents; a transform: its result as it returned it", async () => {
    const virtual = await ops.plainVirtual();
    expect(virtual).toEqual(await ops.toPlainVirtual());
    expect(virtual.holderDocs?.[0]).toEqual({ _id: R21.h1.toHexString(), name: "h1", score: "7" });
    /* the transform's value is the user's: its ObjectId stays an ObjectId (the type says the same) */
    const transformed = await ops.plainTransform();
    expect(transformed.owner).toEqual({ id: R21.h1, name: "h1" });
    expect(transformed.owner?.id).toBeInstanceOf(ObjectId);
  });

  test("a root discriminator: its own model, and the base model (the row's class by its key)", async () => {
    const pulse = await ops.plainPulse();
    /* through the base model: the discriminator's schema converts its fields (the type is the base's, as for lean) */
    expect(await m.Signals.findById(R21.pulse).orFail().plain()).toEqual(pulse);
    expect(pulse).toEqual({
      _id: R21.pulse.toHexString(),
      __t: "pulse",
      label: "p",
      energy: `${BIG}` as const,
      sources: new Map([["a", R21.marker.toHexString()]]),
    });
    expect(pulse).toEqual(await ops.toPlainPulse());
  });

  test("find, a cursor (batch by batch), findOneAndUpdate: the same plain rows", async () => {
    const list = await ops.plainList();
    expect(list.map((row) => row.name)).toEqual(["boss", "h1", "h2"]);
    expect(list[0]?.spots).toEqual(new Map([["home", { x: 1, weight: `${BIG}` as const }]]));
    expect(await ops.plainCursor()).toEqual(list);
    const updated = await ops.plainUpdated();
    expect(updated).toEqual({
      _id: R21.h2.toHexString(),
      name: "h2",
      boss: R21.boss.toHexString(),
      score: `${BIG}` as const,
    });
  });

  test("findOne without a document: null; includeResultMetadata: the value in its plain form", async () => {
    expect(await m.Holders.findOne({ name: "nobody" }).plain()).toBeNull();
    const result = await m.Holders.findOneAndUpdate({ name: "h1" }, { $set: { score: 8n } })
      .plain()
      .includeResultMetadata();
    expect(result.value).toEqual({
      _id: R21.h1.toHexString(),
      name: "h1",
      score: "8" /* Typemo's find-and-modify returns the document after the change by default */,
      boss: R21.boss.toHexString(),
    });
    expect(result.ok).toBe(1);
  });

  test(".parse(schema) and .expect<Shape>() work on plain rows", async () => {
    const Row = z.object({ _id: z.string(), name: z.string(), score: z.string().optional() });
    const rows = await m.Holders.find().select({ name: 1, score: 1 }).sort({ name: 1 }).plain().parse(Row);
    expect(rows).toEqual([
      { _id: R21.boss.toHexString(), name: "boss", score: `${MAX_LONG}` as const },
      { _id: R21.h1.toHexString(), name: "h1", score: "7" },
      { _id: R21.h2.toHexString(), name: "h2" },
    ]);
    const streamed: unknown[] = [];
    for await (const row of m.Holders.find().select({ name: 1 }).plain().parse(Row).cursor()) streamed.push(row);
    expect(streamed.length).toBe(3);
    const typed = await m.Holders.find().select({ name: 1, _id: 0 }).plain().expect<{ name: string }>();
    expect(typed.map((row) => row.name).sort()).toEqual(["boss", "h1", "h2"]);
  });

  test(".lean() after .plain() is lean again; .plain() options other than hidden are a QueryError", async () => {
    const lean = await m.Holders.findById(R21.h1).plain().lean().orFail();
    expect(lean._id).toBeInstanceOf(ObjectId);
    expect(lean.score).toBe(7n);
    /* cast: a JavaScript caller passing an option `.plain()` does not have */
    expect(() => m.Holders.find().plain({ virtuals: true } as never)).toThrow(QueryError);
    expect(() => m.Holders.find().plain(null as never)).toThrow(QueryError);
  });

  test("explain() of a plain query is the server's plan (not converted)", async () => {
    const plan = await m.Holders.find().plain().explain();
    expect(plan).toHaveProperty("queryPlanner");
  });
});

describe("aggregate().plain(): rows by the table alone", () => {
  test("every value in its plain form; a stored Map is a record (a row has no schema)", async () => {
    expect(await ops.aggregatePlain()).toEqual([
      {
        _id: R21.all.toHexString(),
        long: `${BIG}` as const,
        dec: "19.99",
        vBits: BITS,
        prices: { p: "0.10" },
        date: new Date("2026-09-28T10:00:00.000Z"),
      },
    ]);
  });

  test("its cursor and its parse follow", async () => {
    const aggregation = m.Holders.aggregate((p) => p.sort({ name: 1 }).project({ score: 1, _id: 0 })).plain();
    expect(await aggregation.cursor().toArray()).toEqual([{ score: `${MAX_LONG}` as const }, { score: "7" }, {}]);
    const parsed = await aggregation.parse(z.object({ score: z.string().optional() }));
    expect(parsed.length).toBe(3);
  });
});

describe("every form of the same stored document", () => {
  test("lean(): the driver's values (bigint, Binary vectors, Map as a record)", async () => {
    const lean = await ops.lean();
    expect(lean.long).toBe(BIG);
    expect(lean.grid).toEqual([[1n, MAX_LONG], [-MAX_LONG - 1n]]);
    expect(lean.vBits).toBeInstanceOf(Binary);
    expect(lean.dec).toBeInstanceOf(Decimal128);
    expect(lean.ts).toBeInstanceOf(Timestamp);
    expect(lean.spotsByName).toEqual({ a: { x: 3, weight: 1n } });
    expect(lean.secret).toBe("s3cret"); /* lean keeps what the query selected */
  });

  test("$toObject(): BSON values as they are, a Map as a Map", async () => {
    const object = await ops.toObject();
    expect(object.long).toBe(BIG);
    expect(object.vInt8).toBeInstanceOf(Binary);
    expect(object.spotsByName).toBeInstanceOf(Map);
    expect(object.secret).toBe("s3cret"); /* in by default for $toObject */
  });

  test("$toJSON(): int64 a decimal string at any size, a vector its values", async () => {
    const json = await ops.toJson();
    expect(json.long).toBe("9007199254740993");
    expect(json.grid).toEqual([["1", `${MAX_LONG}` as const], [`${-MAX_LONG - 1n}` as const]]);
    expect(json.vInt8).toEqual([-128, 0, 127]);
    expect(json.vFloat32).toEqual([0.5, -2.25]);
    expect(json.vBits).toEqual(BITS);
    expect(json.bin).toBe("AQID"); /* a plain Binary stays base64 */
    expect(json.date).toBe("2026-09-28T10:00:00.000Z");
    expect(json.spotsByName).toEqual({ a: { x: 3, weight: "1" } });
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });
});

describe("hooks see the lean result; the plain form is made after them", () => {
  const seen: unknown[] = [];

  /** An entity whose `query.findOne` post hook records the row it receives. */
  @Schema({ collection: "r21_traced" })
  class Traced extends Entity {
    @Prop(() => Types.ObjectId)
    ref?: ObjectId;

    @Post("query.findOne")
    after(this: OperationHookContext<Traced, "query.findOne">, row: unknown): void {
      seen.push(row);
    }
  }

  test("a post hook receives the lean row (ObjectId); the caller gets the plain row", async () => {
    /*
     * Pinned: `.plain()` runs the lean operation through the whole pipeline (post hooks included) and converts its
     * result afterwards.
     */
    const ref = new ObjectId();
    await t.mongo.db.collection("r21_traced").insertOne({ ref });
    const row = await t.connection.model(Traced).findOne().plain().orFail();
    expect(row.ref).toBe(ref.toHexString());
    expect((seen[0] as { readonly ref: unknown }).ref).toBeInstanceOf(ObjectId);
  });
});
