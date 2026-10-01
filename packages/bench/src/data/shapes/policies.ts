import { Entity, Prop, Schema, Versioned } from "@venloc/typemo";
import type { Document } from "mongodb";
import type { Rng } from "../rng.ts";
import { ShapeDef } from "./shape-def.ts";

/** A document with the soft-delete policy. */
@Schema({ collection: "bench_soft", softDelete: true })
export class SoftDoc extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { required: true }) email!: string;
  @Prop(() => Number, { required: true, min: 0, index: true }) age!: number;
  @Prop(() => Date, { nullable: true }) deletedAt?: Date | null;
}

/** A document with optimistic concurrency. */
@Schema({ collection: "bench_versioned", optimisticConcurrency: true })
export class VersionedDoc extends Versioned(Entity) {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number, { required: true }) score!: number;
  @Prop(() => [String]) tags!: string[];
}

/**
 * Generates the input of one person.
 *
 * @param i - The document index.
 * @param rng - The random source seeded for this document.
 * @returns The input document.
 */
const person = (i: number, rng: Rng): Document => ({
  name: `${rng.word()} ${rng.word()}`,
  email: `soft${i}@bench.test`,
  age: rng.int(0, 99),
});

/** Soft delete (H): Typemo's policy against the explicit `$set: { deletedAt }` a Mongoose/driver user writes. */
export const SOFT = new ShapeDef<SoftDoc>({
  name: "soft",
  namespace: 0x50f7000e,
  collection: "bench_soft",
  entity: SoftDoc,
  mongooseName: "BenchSoft",
  mongooseSchema: (m) =>
    new m.Schema(
      {
        name: { type: String, required: true },
        email: { type: String, required: true },
        age: { type: Number, required: true, min: 0, index: true },
        deletedAt: { type: Date, default: null },
      },
      { versionKey: false },
    ),
  indexes: [{ keys: { age: 1 } }],
  generate: person,
  complete: (input) => ({ ...input, deletedAt: null }),
});

/** Optimistic concurrency (G): `__v` in the filter and `$inc` on every save, in all three contestants. */
export const VERSIONED = new ShapeDef<VersionedDoc>({
  name: "versioned",
  namespace: 0x7e50000f,
  collection: "bench_versioned",
  entity: VersionedDoc,
  mongooseName: "BenchVersioned",
  mongooseSchema: (m) =>
    new m.Schema(
      { name: { type: String, required: true }, score: { type: Number, required: true }, tags: [String] },
      { optimisticConcurrency: true },
    ),
  indexes: [],
  generate: (_i, rng) => ({ name: rng.word(), score: rng.money(0, 100), tags: [rng.word(), rng.word()] }),
  complete: (input) => ({ ...input, __v: 0 }),
});
