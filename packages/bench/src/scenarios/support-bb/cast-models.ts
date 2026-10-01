/*
 * Group N (no server): the entity whose filters/updates/documents are cast, and entities with 10/100/1000
 * validated fields (added by a plugin, so the field count is a parameter), with the Mongoose equivalents.
 */
import "reflect-metadata";
import { Entity, Plugin, Prop, Schema, type SchemaPlugin, Types } from "@venloc/typemo";
import type { ObjectId } from "mongodb";
import type { Model, Schema as MSchema } from "mongoose";
import type { MongooseHandle } from "../../adapters/bench-context.ts";

/** An embedded item. */
@Schema()
export class NItem {
  @Prop(() => String, { required: true })
  sku!: string;

  @Prop(() => Number, { required: true })
  qty!: number;
}

/** A nested profile. */
@Schema({ nested: true })
export class NProfile {
  @Prop(() => Number)
  age?: number;

  @Prop(() => String)
  city?: string;
}

/** The entity whose filters, updates and documents are cast. */
@Schema({ collection: "bb_n_casts" })
export class NCast extends Entity {
  @Prop(() => Types.ObjectId)
  userId?: ObjectId;

  @Prop(() => Date)
  at?: Date;

  @Prop(() => Number)
  n?: number;

  @Prop(() => String)
  name?: string;

  @Prop(() => [String])
  tags?: string[];

  @Prop(() => [NItem])
  items?: NItem[];

  @Prop(() => NProfile)
  profile?: NProfile;
}

/**
 * A synchronous validator on every field (both libraries: `>= 0`).
 *
 * @param value - The field value.
 * @returns `true` when valid, otherwise a message.
 */
export const nonNegative = (value: number): true | string => value >= 0 || "negative";

/**
 * A plugin that adds validated numeric fields.
 *
 * @param count - How many fields.
 * @returns The plugin.
 */
const fieldsPlugin = (count: number): SchemaPlugin => ({
  name: `bb-validated-fields-${count}`,
  apply: (builder) => {
    for (let i = 0; i < count; i++) builder.addField(`f${i}`, () => Number, { required: true, validate: nonNegative });
  },
});

/** An entity with 10 validated fields. */
@Plugin(fieldsPlugin(10))
@Schema({ collection: "bb_n_v10" })
export class NValidated10 extends Entity {}

/** An entity with 100 validated fields. */
@Plugin(fieldsPlugin(100))
@Schema({ collection: "bb_n_v100" })
export class NValidated100 extends Entity {}

/** An entity with 1000 validated fields. */
@Plugin(fieldsPlugin(1000))
@Schema({ collection: "bb_n_v1000" })
export class NValidated1000 extends Entity {}

/** The validated entities by field count. */
export const N_VALIDATED = { 10: NValidated10, 100: NValidated100, 1000: NValidated1000 } as const;

/**
 * A loosely typed Mongoose model.
 *
 * @example
 * ```ts
 * const Casts: MModel = NMongoose.cast(handle);
 * ```
 */
type MModel = Model<Record<string, unknown>>;

/** The Mongoose models of group N. */
export class NMongoose {
  /**
   * The model whose filters, updates and documents are cast.
   *
   * @param handle - The Mongoose contestant.
   * @returns The model.
   */
  static cast(handle: MongooseHandle): MModel {
    return handle.model("BbNCast", "bb_n_casts", (m) => {
      const item = new m.Schema(
        { sku: { type: String, required: true }, qty: { type: Number, required: true } },
        { _id: false },
      );
      return new m.Schema({
        userId: m.Schema.Types.ObjectId,
        at: Date,
        n: Number,
        name: String,
        tags: [String],
        items: [item],
        profile: { age: Number, city: String },
      });
    });
  }

  /**
   * A model with validated numeric fields.
   *
   * @param handle - The Mongoose contestant.
   * @param count - How many fields.
   * @returns The model.
   */
  static validated(handle: MongooseHandle, count: 10 | 100 | 1000): MModel {
    return handle.model(`BbNValidated${count}`, `bb_n_v${count}`, (m) => {
      const definition: Record<string, unknown> = {};
      for (let i = 0; i < count; i++)
        definition[`f${i}`] = { type: Number, required: true, validate: { validator: (v: number) => v >= 0 } };
      return new m.Schema(definition) as MSchema;
    });
  }
}
