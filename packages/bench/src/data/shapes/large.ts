import type { Document } from "mongodb";
import type mongoose from "mongoose";
import type { Rng } from "../rng.ts";
import { LARGE_META, LARGE_NUMBERS, LARGE_STRINGS, LargeDoc } from "./large-doc.generated.ts";
import { ShapeDef } from "./shape-def.ts";

export { LargeDoc, LargeItem, LargeMeta } from "./large-doc.generated.ts";

/**
 * Zero-pads a field number to three digits.
 *
 * @param n - The number.
 * @returns For example `007`.
 */
const pad = (n: number): string => String(n).padStart(3, "0");
/** Subdocuments per large document. */
const ITEMS = 180;

/**
 * The Mongoose schema of the large shape, equivalent to `LargeDoc`.
 *
 * @param m - The Mongoose instance to build with.
 * @returns The schema.
 */
const schemaOf = (m: mongoose.Mongoose): mongoose.Schema => {
  const item = new m.Schema(
    {
      sku: { type: String, required: true },
      qty: { type: Number, required: true, min: 0 },
      price: { type: Number, required: true, min: 0 },
      note: String,
      tags: [String],
    },
    { _id: false },
  );
  const definition: Record<string, unknown> = {};
  for (let i = 0; i < LARGE_STRINGS; i++) {
    definition[`s${pad(i)}`] = i === 0 ? { type: String, required: true, index: true } : String;
  }
  for (let i = 0; i < LARGE_NUMBERS; i++) definition[`n${pad(i)}`] = Number;
  const meta: Record<string, unknown> = {};
  for (let i = 0; i < LARGE_META; i++) meta[`m${i}`] = String;
  definition.meta = meta;
  definition.items = [item];
  return new m.Schema(definition, { versionKey: false, minimize: false });
};

/**
 * Generates the input of one large document.
 *
 * @param i - The document index.
 * @param rng - The random source seeded for this document.
 * @returns The input document.
 */
const generate = (i: number, rng: Rng): Document => {
  const doc: Record<string, unknown> = {};
  for (let s = 0; s < LARGE_STRINGS; s++) doc[`s${pad(s)}`] = s === 0 ? `large-${i}` : rng.words(6);
  for (let n = 0; n < LARGE_NUMBERS; n++) doc[`n${pad(n)}`] = rng.int(0, 1_000_000);
  const meta: Record<string, string> = {};
  for (let k = 0; k < LARGE_META; k++) meta[`m${k}`] = rng.words(2);
  doc.meta = meta;
  const items: Document[] = [];
  for (let k = 0; k < ITEMS; k++) {
    items.push({
      sku: `sku-${i}-${k}`,
      qty: rng.int(0, 100),
      price: rng.money(1, 500),
      note: rng.words(60),
      tags: [rng.word(), rng.word(), rng.word()],
    });
  }
  doc.items = items;
  return doc;
};

/** Shape 3:~100 KB, ~200 fields, an array of 180 subdocuments. */
export const LARGE = new ShapeDef<LargeDoc>({
  name: "large",
  namespace: 0x1a4e0003,
  collection: "bench_large",
  entity: LargeDoc,
  mongooseName: "BenchLarge",
  mongooseSchema: schemaOf,
  indexes: [{ keys: { s000: 1 } }],
  generate,
  counts: { T: 10, S: 100, M: 1_000, L: 10_000, XL: 50_000 },
});
