/*
 * Group J: sales with a product reference, the same collections for Typemo (classes) and Mongoose (schemas),
 * seeded deterministically with the raw driver into every contestant's database.
 */
import "reflect-metadata";
import { Entity, Prop, type Ref, Schema, Types } from "@venloc/typemo";
import type { Db } from "mongodb";
import type { Model } from "mongoose";
import type { MongooseHandle } from "../../adapters/bench-context.ts";
import { Rng } from "../../data/rng.ts";
import { ISeed } from "./populate-models.ts";

/** The collections of group J. */
export const J_COLLECTIONS = { sales: "bb_j_sales", products: "bb_j_products" } as const;
/** The collection that records how many sales are seeded. */
const J_MARKER = "bb_j_marker";
/** The sales regions. */
export const J_REGIONS = ["north", "south", "east", "west", "center"] as const;
/** The tags a sale can carry. */
export const J_TAGS = ["new", "promo", "gift", "bulk", "x", "vip"] as const;
/** The number of products. */
export const J_PRODUCTS = 200;

/** A product. */
@Schema({ collection: J_COLLECTIONS.products })
export class JProduct extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String, { required: true })
  category!: string;

  @Prop(() => Number, { required: true })
  price!: number;
}

/** A sale of a product. */
@Schema({ collection: J_COLLECTIONS.sales })
export class JSale extends Entity {
  @Prop(() => String, { required: true })
  region!: string;

  @Prop(() => String, { required: true })
  channel!: string;

  @Prop(() => Types.ObjectId, { ref: () => JProduct, required: true })
  product!: Ref<JProduct>;

  @Prop(() => Number, { required: true })
  amount!: number;

  @Prop(() => Number, { required: true })
  qty!: number;

  @Prop(() => Date, { required: true })
  at!: Date;

  @Prop(() => [String])
  tags!: string[];
}

/**
 * A loosely typed Mongoose model.
 *
 * @example
 * ```ts
 * const Sales: MModel = JMongoose.sales(handle);
 * ```
 */
type MModel = Model<Record<string, unknown>>;

/** The Mongoose models of group J. */
export class JMongoose {
  /**
   * The sales model.
   *
   * @param handle - The Mongoose contestant.
   * @returns The model.
   */
  static sales(handle: MongooseHandle): MModel {
    return handle.model(
      "BbJSale",
      J_COLLECTIONS.sales,
      (m) =>
        new m.Schema({
          region: { type: String, required: true },
          channel: { type: String, required: true },
          product: { type: m.Schema.Types.ObjectId, ref: "BbJProduct", required: true },
          amount: { type: Number, required: true },
          qty: { type: Number, required: true },
          at: { type: Date, required: true },
          tags: [String],
        }),
    );
  }

  /**
   * The products model.
   *
   * @param handle - The Mongoose contestant.
   * @returns The model.
   */
  static products(handle: MongooseHandle): MModel {
    return handle.model(
      "BbJProduct",
      J_COLLECTIONS.products,
      (m) =>
        new m.Schema({
          name: { type: String, required: true },
          category: { type: String, required: true },
          price: { type: Number, required: true },
        }),
    );
  }
}

/** Seeds the collections of group J. */
export class JSeed {
  /**
   * Seeds `sales` documents (integer amounts: sums are exact in any order) unless already there.
   *
   * @param db - The database.
   * @param sales - How many sales.
   */
  static async seed(db: Db, sales: number): Promise<void> {
    const marker = db.collection<{ _id: string; sales: number }>(J_MARKER);
    if ((await marker.findOne({ _id: "sales" }))?.sales === sales) return;
    await marker.deleteMany({});
    await db.collection(J_COLLECTIONS.sales).deleteMany({});
    await db.collection(J_COLLECTIONS.products).deleteMany({});
    await db.collection(J_COLLECTIONS.products).insertMany(
      Array.from({ length: J_PRODUCTS }, (_, i) => ({
        _id: ISeed.oid(0x10, i),
        name: `product-${i}`,
        category: `cat-${i % 12}`,
        price: 1 + (i % 50),
      })),
    );
    const rng = new Rng(0xb0b);
    const base = Date.UTC(2026, 0, 1);
    for (let start = 0; start < sales; start += 10_000) {
      const batch = Array.from({ length: Math.min(10_000, sales - start) }, (_, k) => {
        const i = start + k;
        return {
          _id: ISeed.oid(0x11, i),
          region: J_REGIONS[rng.int(0, J_REGIONS.length - 1)] as string,
          channel: rng.next() < 0.5 ? "web" : "store",
          product: ISeed.oid(0x10, rng.int(0, J_PRODUCTS - 1)),
          amount: rng.int(1, 500),
          qty: rng.int(0, 9),
          at: new Date(base + i * 60_000),
          tags: [J_TAGS[rng.int(0, J_TAGS.length - 1)] as string, J_TAGS[rng.int(0, J_TAGS.length - 1)] as string],
        };
      });
      await db.collection(J_COLLECTIONS.sales).insertMany(batch, { ordered: false });
    }
    await db.collection(J_COLLECTIONS.sales).createIndex({ region: 1, at: 1 });
    await marker.insertOne({ _id: "sales", sales });
  }
}
