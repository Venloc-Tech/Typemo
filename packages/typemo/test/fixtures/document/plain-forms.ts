/*
 * The data and the operations of the plain-form tests, written ONCE: the runtime tests run them on the
 * server, the shape tests read their result types from this module (the type probe) — every form of the same
 * document: hydrated → `$toPlain()` / `$toObject()` / `$toJSON()`, and the reads `.plain()` / `.lean()`.
 */
import { Binary, type Db, Decimal128, Int32, ObjectId, Timestamp, UUID } from "mongodb";
import type { Model } from "../../../src/index.ts";
import { AllForms, Holder, Pulse, Signal, Vault } from "./plain-entities.ts";

/** The ids of the seeded documents. */
export const R21 = {
  all: new ObjectId("66f000000000000000000001"),
  boss: new ObjectId("66f000000000000000000010"),
  h1: new ObjectId("66f000000000000000000011"),
  h2: new ObjectId("66f000000000000000000012"),
  pulse: new ObjectId("66f000000000000000000020"),
  marker: new ObjectId("66f000000000000000000030"),
  vault: new ObjectId("66f000000000000000000040"),
  uuid: new UUID("0f8fad5b-d9cb-469f-a165-70867728950e"),
} as const;

/** 2^53 + 1: not a safe integer (JSON refuses it as a number; the plain form writes the exact decimal string). */
export const BIG = 9_007_199_254_740_993n;
/** The largest int64. */
export const MAX_LONG = 9_223_372_036_854_775_807n;
/** 10 bits: the last byte of the packed-bit vector carries 6 padding bits. */
export const BITS = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1];

/** The models of the fixtures on a connection. */
export interface PlainModels {
  readonly All: Model<AllForms>;
  readonly Holders: Model<Holder>;
  readonly Signals: Model<Signal>;
  readonly Pulses: Model<Pulse>;
  readonly Vaults: Model<Vault>;
}

/**
 * Seeds the documents with the raw driver (the exact BSON types, as another writer would).
 *
 * @param db - the test database; the fixture collections are emptied first
 */
export const seedPlainForms = async (db: Db): Promise<void> => {
  await db.collection("r21_holders").deleteMany({});
  await db.collection("r21_all_forms").deleteMany({});
  await db.collection("r21_signals").deleteMany({});
  await db.collection("r26_vaults").deleteMany({});
  await db.collection("r21_holders").insertMany([
    { _id: R21.boss, name: "boss", score: MAX_LONG, spots: { home: { x: 1, weight: BIG } }, pin: "p0" },
    { _id: R21.h1, name: "h1", score: 7n, boss: R21.boss, pin: "p1" },
    { _id: R21.h2, name: "h2", boss: R21.boss },
  ]);
  await db.collection("r21_all_forms").insertOne({
    _id: R21.all,
    str: "all",
    num: 1.5,
    i32: new Int32(42),
    long: BIG,
    dec: Decimal128.fromString("19.99"),
    bool: true,
    date: new Date("2026-09-28T10:00:00.000Z"),
    bin: new Binary(new Uint8Array([1, 2, 3])),
    uuid: R21.uuid,
    vInt8: Binary.fromInt8Array(new Int8Array([-128, 0, 127])),
    vFloat32: Binary.fromFloat32Array(new Float32Array([0.5, -2.25])),
    vBits: Binary.fromBits(BITS),
    re: /a.b/i,
    ts: new Timestamp({ t: 1_700_000_000, i: 7 }),
    nil: null,
    grid: [[1n, MAX_LONG], [-MAX_LONG - 1n]],
    spots: [
      { x: 1, weight: BIG },
      { x: 2, marker: R21.marker },
    ],
    spotsByName: { a: { x: 3, weight: 1n } },
    prices: { p: Decimal128.fromString("0.10") },
    secret: "s3cret",
    owner: R21.h1,
    holders: [R21.h1, R21.h2],
    holdersByRole: { lead: R21.h1 },
  });
  await db.collection("r21_signals").insertOne({
    _id: R21.pulse,
    __t: "pulse",
    label: "p",
    energy: BIG,
    sources: { a: R21.marker },
  });
  await db.collection("r26_vaults").insertOne({
    _id: R21.vault,
    name: "v",
    main: { label: "main", code: "c-main" },
    lockers: [
      { label: "l0", code: "c-l0" },
      { label: "l1", code: "c-l1" },
    ],
    byRoom: { hall: { label: "hall", code: "c-hall" } },
    keeper: R21.h1,
  });
};

/**
 * The `AllForms` document with its `Hidden` field selected.
 *
 * @param m - the models of the fixtures
 * @returns the query
 */
const all = (m: PlainModels) => m.All.findById(R21.all).select({ "+secret": true }).orFail();
/**
 * The `AllForms` document with references populated on two levels, an array and a Map.
 *
 * @param m - the models of the fixtures
 * @returns the query
 */
const populated = (m: PlainModels) =>
  m.All.findById(R21.all)
    .select({ str: 1, owner: 1, holders: 1, holdersByRole: 1 })
    .populate({ path: "owner", populate: { path: "boss", select: { "+pin": true } } })
    .populate({ path: "holders", select: { name: 1, score: 1 } })
    .populate({ path: "holdersByRole.$*", select: { name: 1 } })
    .orFail();

/**
 * A vault with `Hidden` fields at every depth — selected with `+path` (subdocument, array elements), named by the
 * inclusion of the populated `keeper`, loaded in a Map of subdocuments — which the plain and JSON forms leave out
 * unless `{ hidden: true }`. Every field is filled, so the shape tests can require the optional keys too.
 *
 * @param m - the models of the fixtures
 * @returns the query
 */
const vault = (m: PlainModels) =>
  m.Vaults.findById(R21.vault)
    .select({ "+main.code": true, "+lockers.code": true })
    .populate({ path: "keeper", select: { name: 1, pin: 1 } })
    .orFail();

/**
 * The operations (each resolves to one form of the same data).
 *
 * @param m - the models of the fixtures
 * @returns one lazy operation per form, keyed by name
 */
export const plainForms = (m: PlainModels) => ({
  /* one document, every form */
  toPlain: async () => (await all(m)).$toPlain(),
  toPlainHidden: async () => (await all(m)).$toPlain({ hidden: true }),
  toPlainVirtuals: async () => (await all(m)).$toPlain({ virtuals: true }),
  plain: () => all(m).plain(),
  plainHidden: () => all(m).plain({ hidden: true }),
  lean: () => all(m).lean(),
  toObject: async () => (await all(m)).$toObject(),
  toJson: async () => (await all(m)).$toJSON(),
  /* populated two levels (a Map of subdocuments and a Hidden field in the populated documents), an array, a Map */
  toPlainPopulated: async () => (await populated(m)).$toPlain(),
  plainPopulated: () => populated(m).plain(),
  plainPopulatedHidden: () => populated(m).plain({ hidden: true }),
  /* a populate virtual, a transform (its result stays as the transform returned it) */
  plainVirtual: () =>
    m.All.findById(R21.all)
      .select({ holders: 1 })
      .populate({ path: "holderDocs", select: { name: 1, score: 1 } })
      .orFail()
      .plain(),
  toPlainVirtual: async () =>
    (
      await m.All.findById(R21.all)
        .select({ holders: 1 })
        .populate({ path: "holderDocs", select: { name: 1, score: 1 } })
        .orFail()
    ).$toPlain(),
  plainTransform: () =>
    m.All.findById(R21.all)
      .select({ owner: 1 })
      .populate({ path: "owner", transform: (doc, id) => ({ id, name: doc?.name ?? null }) })
      .orFail()
      .plain(),
  /* a discriminator (its own model; the base model reads its rows too — typed as the base: runtime test) */
  plainPulse: () => m.Pulses.findById(R21.pulse).orFail().plain(),
  toPlainPulse: async () => (await m.Pulses.findById(R21.pulse).orFail()).$toPlain(),
  /* lists: find, cursor, findOneAndUpdate, aggregate */
  plainList: () => m.Holders.find().sort({ name: 1 }).plain(),
  plainCursor: () => m.Holders.find().sort({ name: 1 }).batchSize(1).plain().cursor().toArray(),
  plainUpdated: () =>
    m.Holders.findOneAndUpdate({ name: "h2" }, { $set: { score: BIG } }, { returnDocument: "after" })
      .orFail()
      .plain(),
  /* masked forms — the type of `mask` / `.mask()` against the masked copy */
  toPlainMasked: async () =>
    (await all(m)).$toPlain({ mask: { str: "mask", long: (long: string | undefined) => long?.length } }),
  toJsonMasked: async () => (await all(m)).$toJSON({ mask: { dec: "mask" } }),
  toObjectMasked: async () => (await all(m)).$toObject({ mask: { str: "mask" } }),
  plainMasked: () =>
    all(m)
      .plain()
      .mask({ str: "mask", date: (date: Date | undefined) => date?.getUTCFullYear() }),
  aggregatePlainMasked: () =>
    m.All.aggregate((p) => p.match({ str: "all" }).project({ long: 1, dec: 1, date: 1 }))
      .plain()
      .mask({ dec: "mask", long: (long: string | undefined) => long?.length }),
  aggregatePlain: () =>
    m.All.aggregate((p) => p.match({ str: "all" }).project({ long: 1, dec: 1, vBits: 1, prices: 1, date: 1 })).plain(),
  /* Hidden fields below the root and in a populated document, with and without the option */
  vaultToPlain: async () => (await vault(m)).$toPlain(),
  vaultToPlainHidden: async () => (await vault(m)).$toPlain({ hidden: true }),
  vaultToJson: async () => (await vault(m)).$toJSON(),
  vaultToJsonHidden: async () => (await vault(m)).$toJSON({ hidden: true }),
  vaultPlain: () => vault(m).plain(),
  vaultPlainHidden: () => vault(m).plain({ hidden: true }),
  vaultToObject: async () => (await vault(m)).$toObject(),
  vaultToObjectNoHidden: async () => (await vault(m)).$toObject({ hidden: false }),
});

/**
 * The operations object returned by `plainForms`.
 *
 * @example
 * type Plain = Awaited<ReturnType<PlainForms["toPlain"]>>;
 */
export type PlainForms = ReturnType<typeof plainForms>;

/**
 * The models on a connection.
 *
 * @param connection - anything that can build a model from an entity class
 * @returns one model per fixture entity
 */
export const plainModels = (connection: { model<T extends object>(entity: abstract new () => T): Model<T> }) => ({
  All: connection.model(AllForms),
  Holders: connection.model(Holder),
  Signals: connection.model(Signal),
  Pulses: connection.model(Pulse),
  Vaults: connection.model(Vault),
});
