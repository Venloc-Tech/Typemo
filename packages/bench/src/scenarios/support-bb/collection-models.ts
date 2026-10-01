/*
 * Group M (no server): one entity with every kind of typed collection, the Mongoose schema with the
 * same paths. Documents are made with `Model.hydrate(raw)` on both sides (a loaded document: tracked
 * collections, no changes yet); nothing is ever sent to the server.
 */
import "reflect-metadata";
import { Entity, Prop, Schema, Spec } from "@venloc/typemo";
import type { ObjectId } from "mongodb";
import type { Model } from "mongoose";
import type { MongooseHandle } from "../../adapters/bench-context.ts";
import { ISeed } from "./populate-models.ts";

/** A subdocument row. */
@Schema()
export class MRow extends Entity {
  @Prop(() => String, { required: true })
  note!: string;

  @Prop(() => Number, { required: true })
  lines!: number;
}

/** An entity with an array of numbers, an array of subdocuments and a Map. */
@Schema({ collection: "bb_m_bags" })
export class MBag extends Entity {
  @Prop(() => [Number])
  nums!: number[];

  @Prop(() => [MRow])
  rows!: MRow[];

  @Prop(() => Spec.map(Number))
  scores!: Map<string, number>;
}

/** The Mongoose models of group M. */
export class MMongoose {
  /**
   * The bag model.
   *
   * @param handle - The Mongoose contestant.
   * @returns The model.
   */
  static bag(handle: MongooseHandle): Model<Record<string, unknown>> {
    return handle.model(
      "BbMBag",
      "bb_m_bags",
      (m) =>
        new m.Schema({
          nums: [Number],
          rows: [new m.Schema({ note: { type: String, required: true }, lines: { type: Number, required: true } })],
          scores: { type: Map, of: Number },
        }),
    );
  }
}

/** Raw (stored-form) bags, shared by both contestants. */
export class MRaw {
  /** The id of every bag. */
  static readonly id = ISeed.oid(0x40, 0);

  /**
   * The id of a row.
   *
   * @param i - The row index.
   * @returns The deterministic id.
   */
  static rowId(i: number): ObjectId {
    return ISeed.oid(0x41, i);
  }

  /**
   * A stored bag.
   *
   * @param nums - Length of the number array.
   * @param rows - Number of subdocument rows.
   * @param scores - Number of Map entries.
   * @returns The stored document.
   */
  static bag(nums: number, rows = 0, scores = 0): Record<string, unknown> {
    return {
      _id: MRaw.id,
      nums: Array.from({ length: nums }, (_, i) => i),
      rows: Array.from({ length: rows }, (_, i) => ({ _id: MRaw.rowId(i), note: `n${i}`, lines: i })),
      scores: Object.fromEntries(Array.from({ length: scores }, (_, i) => [`k${i}`, i])),
    };
  }
}
