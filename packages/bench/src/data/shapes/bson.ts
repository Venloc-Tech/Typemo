import { Entity, Prop, Schema, Spec, Types, type Vector } from "@venloc/typemo";
import { Binary, Decimal128, type Document, ObjectId, Timestamp, UUID } from "mongodb";
import type { Rng } from "../rng.ts";
import { ShapeDef } from "./shape-def.ts";

/** Size of the binary payload of `BINARY_1MB`, in bytes. */
export const BINARY_BYTES = 1024 * 1024;
/** Dimensions of the vector of `VECTOR`. */
export const VECTOR_DIMENSIONS = 1536;

/** A nested object inside `AllBsonDoc`. */
@Schema({ nested: true })
export class BsonInner {
  @Prop(() => String) s?: string;
}

/** A document with one field of every BSON type the contestants share. */
@Schema({ collection: "bench_all_bson" })
export class AllBsonDoc extends Entity {
  @Prop(() => String, { required: true }) str!: string;
  @Prop(() => Types.Int32, { required: true }) int32!: number;
  @Prop(() => Types.Double, { required: true }) dbl!: number;
  @Prop(() => BigInt, { required: true }) long!: bigint;
  @Prop(() => Types.Decimal128, { required: true }) dec!: Types.Decimal128;
  @Prop(() => Boolean, { required: true }) bool!: boolean;
  @Prop(() => Date, { required: true }) date!: Date;
  @Prop(() => Types.ObjectId, { required: true }) oid!: Types.ObjectId;
  @Prop(() => Types.UUID, { required: true }) uuid!: Types.UUID;
  @Prop(() => Types.Binary, { required: true }) bin!: Types.Binary;
  @Prop(() => RegExp, { required: true }) regex!: RegExp;
  @Prop(() => Types.Timestamp, { required: true }) ts!: Types.Timestamp;
  @Prop(() => [Number]) arr!: number[];
  @Prop(() => BsonInner) obj?: BsonInner;
  @Prop(() => String, { nullable: true }) nul!: string | null;
}

/** A document that carries a large binary payload. */
@Schema({ collection: "bench_binary" })
export class BinaryDoc extends Entity {
  @Prop(() => String, { required: true }) label!: string;
  @Prop(() => Types.Binary, { required: true }) data!: Types.Binary;
}

/** A document that carries an embedding vector. */
@Schema({ collection: "bench_vectors" })
export class VectorDoc extends Entity {
  @Prop(() => String, { required: true }) label!: string;
  @Prop(() => Spec.vector({ dtype: "float32", dimensions: VECTOR_DIMENSIONS }), { required: true })
  embedding!: Vector;
}

/**
 * Hex text of some bytes.
 *
 * @param bytes - The bytes.
 * @returns Two hex digits per byte.
 */
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

/** Shape 7: every BSON type the three contestants share (no MinKey/MaxKey: no schema type anywhere). */
export const ALL_BSON = new ShapeDef<AllBsonDoc>({
  name: "all-bson",
  namespace: 0x0b50e007,
  collection: "bench_all_bson",
  entity: AllBsonDoc,
  mongooseName: "BenchAllBson",
  mongooseSchema: (m) =>
    new m.Schema(
      {
        str: { type: String, required: true },
        int32: { type: m.Schema.Types.Int32, required: true },
        dbl: { type: m.Schema.Types.Double, required: true },
        long: { type: m.Schema.Types.BigInt, required: true },
        dec: { type: m.Schema.Types.Decimal128, required: true },
        bool: { type: Boolean, required: true },
        date: { type: Date, required: true },
        oid: { type: m.Schema.Types.ObjectId, required: true },
        uuid: { type: m.Schema.Types.UUID, required: true },
        bin: { type: Buffer, required: true },
        /* Mongoose has no RegExp / Timestamp schema types: Mixed is what a Mongoose user writes. */
        regex: { type: m.Schema.Types.Mixed, required: true },
        ts: { type: m.Schema.Types.Mixed, required: true },
        arr: [Number],
        obj: { s: String },
        nul: { type: String, default: null },
      },
      { versionKey: false, minimize: false },
    ),
  indexes: [],
  generate: (i, rng: Rng): Document => ({
    str: rng.words(3),
    int32: rng.int(-1_000_000, 1_000_000),
    dbl: rng.money(-1000, 1000),
    /* Beyond int32, within ±(2^53−1): Typemo's $toJSON refuses larger int64 by design (no silent precision loss). */
    long: BigInt(rng.int(0, 1_000_000)) * 1_000_000n + 7n,
    dec: Decimal128.fromString(`${rng.int(0, 99999)}.${rng.int(10, 99)}`),
    bool: rng.bool(),
    date: rng.date(),
    oid: ObjectId.createFromHexString(hex(rng.bytes(12))),
    uuid: new UUID(hex(rng.bytes(16))),
    bin: new Binary(Buffer.from(rng.bytes(64))),
    regex: new RegExp(`^${rng.word()}`, "i"),
    ts: new Timestamp({ t: 1_700_000_000 + i, i: rng.int(1, 100) }),
    arr: [rng.int(0, 9), rng.int(0, 9), rng.int(0, 9)],
    obj: { s: rng.word() },
    nul: null,
  }),
});

/** Shape 8: a 1 MB Binary. */
export const BINARY_1MB = new ShapeDef<BinaryDoc>({
  name: "binary-1mb",
  namespace: 0x0b1b0008,
  collection: "bench_binary",
  entity: BinaryDoc,
  mongooseName: "BenchBinary",
  mongooseSchema: (m) =>
    new m.Schema(
      { label: { type: String, required: true }, data: { type: Buffer, required: true } },
      { versionKey: false },
    ),
  indexes: [],
  generate: (i, rng): Document => ({ label: `bin-${i}`, data: new Binary(Buffer.from(rng.bytes(BINARY_BYTES))) }),
  counts: { T: 2, S: 10, M: 100, L: 1_000, XL: 2_000 },
});

/** Shape 9: a 1536 × float32 vector (BSON Binary subtype 9). */
export const VECTOR = new ShapeDef<VectorDoc>({
  name: "vector",
  namespace: 0x0ec70009,
  collection: "bench_vectors",
  entity: VectorDoc,
  mongooseName: "BenchVector",
  mongooseSchema: (m) =>
    new m.Schema(
      { label: { type: String, required: true }, embedding: { type: Buffer, subtype: 9, required: true } },
      { versionKey: false },
    ),
  indexes: [],
  generate: (i, rng): Document => {
    const values = new Float32Array(VECTOR_DIMENSIONS);
    for (let k = 0; k < VECTOR_DIMENSIONS; k++) values[k] = rng.next() * 2 - 1;
    return { label: `vec-${i}`, embedding: Binary.fromFloat32Array(values) };
  },
  counts: { T: 50, S: 1_000, M: 20_000, L: 100_000, XL: 500_000 },
});
