import { Entity, Prop, Schema } from "@venloc/typemo";
import type { Document } from "mongodb";
import type mongoose from "mongoose";
import type { Rng } from "../rng.ts";
import { ShapeDef } from "./shape-def.ts";

/*
 * Declared bottom-up: with emitDecoratorMetadata a nested class used above its declaration hits the
 * temporal dead zone.
 */

/** The deepest level. */
@Schema({ nested: true })
export class Deep7 {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number, { required: true, min: 0 }) n!: number;
  @Prop(() => String) leaf?: string;
}
/** Level 6. */
@Schema({ nested: true })
export class Deep6 {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number, { required: true, min: 0 }) n!: number;
  @Prop(() => Deep7) child?: Deep7;
}
/** Level 5. */
@Schema({ nested: true })
export class Deep5 {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number, { required: true, min: 0 }) n!: number;
  @Prop(() => Deep6) child?: Deep6;
}
/** Level 4. */
@Schema({ nested: true })
export class Deep4 {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number, { required: true, min: 0 }) n!: number;
  @Prop(() => Deep5) child?: Deep5;
}
/** Level 3. */
@Schema({ nested: true })
export class Deep3 {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number, { required: true, min: 0 }) n!: number;
  @Prop(() => Deep4) child?: Deep4;
}
/** Level 2. */
@Schema({ nested: true })
export class Deep2 {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number, { required: true, min: 0 }) n!: number;
  @Prop(() => Deep3) child?: Deep3;
}
/** Level 1. */
@Schema({ nested: true })
export class Deep1 {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number, { required: true, min: 0 }) n!: number;
  @Prop(() => Deep2) child?: Deep2;
}

/** A document with seven levels of nested objects. */
@Schema({ collection: "bench_deep" })
export class DeepDoc extends Entity {
  @Prop(() => String, { required: true }) label!: string;
  @Prop(() => Deep1, { required: true }) root!: Deep1;
}

/**
 * Generates one nested level and everything below it.
 *
 * @param depth - The level, from 1 to 7.
 * @param rng - The random source seeded for this document.
 * @returns The level's input object.
 */
const level = (depth: number, rng: Rng): Document => {
  const node: Document = { name: rng.word(), n: rng.int(0, 1000) };
  if (depth === 7) node.leaf = rng.words(3);
  else node.child = level(depth + 1, rng);
  return node;
};

/**
 * The Mongoose schema definition of one nested level and everything below it.
 *
 * @param depth - The level, from 1 to 7.
 * @returns The schema definition object.
 */
const mongooseLevel = (depth: number): Record<string, unknown> => {
  const node: Record<string, unknown> = {
    name: { type: String, required: true },
    n: { type: Number, required: true, min: 0 },
  };
  if (depth === 7) node.leaf = String;
  else node.child = mongooseLevel(depth + 1);
  return node;
};

/** Shape 4: 7 levels of nested objects. */
export const DEEP7 = new ShapeDef<DeepDoc>({
  name: "deep7",
  namespace: 0x0dee7004,
  collection: "bench_deep",
  entity: DeepDoc,
  mongooseName: "BenchDeep",
  mongooseSchema: (m: mongoose.Mongoose) =>
    new m.Schema(
      { label: { type: String, required: true }, root: mongooseLevel(1) },
      { versionKey: false, minimize: false },
    ),
  indexes: [],
  generate: (i, rng) => ({ label: `deep-${i}`, root: level(1, rng) }),
});
