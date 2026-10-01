import { Entity, Prop, Schema, Timestamped } from "@venloc/typemo";
import type { Document } from "mongodb";
import type { Rng } from "../rng.ts";
import { ShapeDef } from "./shape-def.ts";

/** A small flat document: five scalar fields, a unique email and an indexed age. */
@Schema({ collection: "bench_flat" })
export class FlatDoc extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { required: true, unique: true }) email!: string;
  @Prop(() => Number, { required: true, min: 0, max: 150, index: true }) age!: number;
  @Prop(() => Boolean, { required: true }) active!: boolean;
  @Prop(() => Number, { required: true }) score!: number;
}

/** The flat document with `createdAt` / `updatedAt` timestamps. */
@Schema({ collection: "bench_flat_stamped" })
export class FlatStampedDoc extends Timestamped(Entity) {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { required: true, unique: true }) email!: string;
  @Prop(() => Number, { required: true, min: 0, max: 150 }) age!: number;
  @Prop(() => Boolean, { required: true }) active!: boolean;
  @Prop(() => Number, { required: true }) score!: number;
}

/**
 * Generates the input of one flat document.
 *
 * @param i - The document index.
 * @param rng - The random source seeded for this document.
 * @returns The input document.
 */
const flatFields = (i: number, rng: Rng): Document => ({
  name: `${rng.word()} ${rng.word()}`,
  email: `user${i}@bench.test`,
  age: rng.int(0, 99),
  active: rng.bool(),
  score: rng.money(0, 1000),
});

/** Shape 1: small flat document. */
export const FLAT = new ShapeDef<FlatDoc>({
  name: "flat",
  namespace: 0x0f1a7001,
  collection: "bench_flat",
  entity: FlatDoc,
  mongooseName: "BenchFlat",
  mongooseSchema: (m) =>
    new m.Schema(
      {
        name: { type: String, required: true },
        email: { type: String, required: true, unique: true },
        age: { type: Number, required: true, min: 0, max: 150, index: true },
        active: { type: Boolean, required: true },
        score: { type: Number, required: true },
      },
      { versionKey: false },
    ),
  indexes: [{ keys: { email: 1 }, options: { unique: true } }, { keys: { age: 1 } }],
  generate: flatFields,
});

/** Shape 1 with timestamps (B: insert with timestamps). */
export const FLAT_STAMPED = new ShapeDef<FlatStampedDoc>({
  name: "flat-stamped",
  namespace: 0x0f1a7002,
  collection: "bench_flat_stamped",
  entity: FlatStampedDoc,
  mongooseName: "BenchFlatStamped",
  mongooseSchema: (m) =>
    new m.Schema(
      {
        name: { type: String, required: true },
        email: { type: String, required: true, unique: true },
        age: { type: Number, required: true, min: 0, max: 150 },
        active: { type: Boolean, required: true },
        score: { type: Number, required: true },
      },
      { versionKey: false, timestamps: true },
    ),
  indexes: [{ keys: { email: 1 }, options: { unique: true } }],
  generate: flatFields,
});
