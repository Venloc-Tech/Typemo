import { Entity, Prop, Schema, Spec } from "@venloc/typemo";
import type { Document } from "mongodb";
import type { Rng } from "../rng.ts";
import { ShapeDef } from "./shape-def.ts";

/** Elements of the array of `BIG_ARRAY`. */
export const BIG_ARRAY_LENGTH = 10_000;
/** Keys of the Map of `BIG_MAP`. */
export const BIG_MAP_KEYS = 1_000;

/** A document with a very long array. */
@Schema({ collection: "bench_big_array" })
export class BigArrayDoc extends Entity {
  @Prop(() => String, { required: true }) label!: string;
  @Prop(() => [Number]) values!: number[];
}

/** A document with a Map of many keys. */
@Schema({ collection: "bench_big_map" })
export class BigMapDoc extends Entity {
  @Prop(() => String, { required: true }) label!: string;
  @Prop(() => Spec.map(Number)) counters!: Map<string, number>;
}

/**
 * The elements of the big array.
 *
 * @param rng - The random source seeded for this document.
 * @returns `BIG_ARRAY_LENGTH` numbers.
 */
const values = (rng: Rng): number[] => {
  const out: number[] = new Array(BIG_ARRAY_LENGTH);
  for (let k = 0; k < BIG_ARRAY_LENGTH; k++) out[k] = rng.int(0, 1_000_000);
  return out;
};

/**
 * The entries of the big Map, as a plain record.
 *
 * @param rng - The random source seeded for this document.
 * @returns `BIG_MAP_KEYS` entries.
 */
const counters = (rng: Rng): Record<string, number> => {
  const out: Record<string, number> = {};
  for (let k = 0; k < BIG_MAP_KEYS; k++) out[`k${k}`] = rng.int(0, 1_000_000);
  return out;
};

/** Shape 5: an array of 10 000 numbers. */
export const BIG_ARRAY = new ShapeDef<BigArrayDoc>({
  name: "big-array",
  namespace: 0x0b1a0005,
  collection: "bench_big_array",
  entity: BigArrayDoc,
  mongooseName: "BenchBigArray",
  mongooseSchema: (m) =>
    new m.Schema({ label: { type: String, required: true }, values: [Number] }, { versionKey: false }),
  indexes: [],
  generate: (i, rng): Document => ({ label: `array-${i}`, values: values(rng) }),
  counts: { T: 5, S: 50, M: 500, L: 5_000, XL: 20_000 },
});

/** Shape 6: a Map of 1 000 keys (input as a plain record — every contestant accepts it). */
export const BIG_MAP = new ShapeDef<BigMapDoc>({
  name: "big-map",
  namespace: 0x0b1a0006,
  collection: "bench_big_map",
  entity: BigMapDoc,
  mongooseName: "BenchBigMap",
  mongooseSchema: (m) =>
    new m.Schema(
      { label: { type: String, required: true }, counters: { type: Map, of: Number } },
      { versionKey: false },
    ),
  indexes: [],
  generate: (i, rng): Document => ({ label: `map-${i}`, counters: counters(rng) }),
  counts: { T: 10, S: 100, M: 2_000, L: 20_000, XL: 100_000 },
});
