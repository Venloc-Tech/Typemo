/*
 * The queries of the mechanism shape tests, written ONCE: the runtime test runs them, the type probe reads
 * their result types from this module (required populate, declared discriminator key, `$updateOne`,
 * a skipped find, the audit trail entry).
 */
import { Discriminator, type DiscriminatorValue, Entity, type Model, Prop, Schema } from "../../../src/index.ts";
import type { PopulateModels } from "../populate/populate-seed.ts";
import { P } from "../populate/populate-seed.ts";

/** The base entity of a discriminator whose key is the default `__t`. */
@Schema({ collection: "s9_shapes" })
export class Shape9 extends Entity {
  @Prop(() => String) label?: string;
}

/** A `Shape9` discriminator with a required radius. */
@Discriminator("circle")
export class Circle9 extends Shape9 {
  declare readonly __t: DiscriminatorValue<"circle">;
  @Prop(() => Number, { required: true }) radius!: number;
}

/**
 * The queries whose result types the shape tests compare with the runtime rows.
 *
 * @param m - the populate models (people, posts, companies)
 * @param Circles - the model of the `Circle9` discriminator
 * @returns one lazy query per case, keyed by name
 */
export const shapeMechanisms = (m: PopulateModels, Circles: Model<Circle9>) => ({
  requiredRef: () => m.People.findById(P.ann).populate({ path: "company", required: true }).orFail().lean(),
  requiredVirtual: () => m.People.findById(P.ann).populate({ path: "topPost", required: true }).orFail().lean(),
  clonedRef: () => m.Posts.find({ author: P.ann }).populate({ path: "author", clone: true }).lean(),
  discriminatorLean: () => Circles.findOne({ radius: 1 }).orFail().lean(),
  updateOneOfDocument: async () => (await m.People.findById(P.ann).orFail()).$updateOne({ $set: { age: 31 } }),
});

/**
 * The queries object returned by `shapeMechanisms`.
 *
 * @example
 * type Row = Awaited<ReturnType<ShapeMechanisms["requiredRef"]>>;
 */
export type ShapeMechanisms = ReturnType<typeof shapeMechanisms>;
