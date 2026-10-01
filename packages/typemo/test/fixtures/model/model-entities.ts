/*
 * A small model graph for the execution tests. `Person` has a unique index, a default, a Hidden field,
 * a Map, an int64, a Decimal128, a nullable date and a subdocument array; `Order` references a person;
 * `Shape` has discriminators.
 */
import type { Decimal128 } from "mongodb";
import {
  type Defaulted,
  Discriminator,
  type DiscriminatorValue,
  Entity,
  type Hidden,
  Index,
  Prop,
  type Ref,
  Schema,
  Spec,
  Types,
} from "../../../src/index.ts";

/** A pet subdocument (an array element of `Person`). */
@Schema()
export class Pet {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => Number)
  age?: number;
}

/** A person with a unique email and every kind of field the execution tests need. */
@Schema({ collection: "m_people" })
@Index({ email: 1 }, { unique: true })
export class Person extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String, { required: true })
  email!: string;

  @Prop(() => Number, { min: 0 })
  age?: number;

  @Prop(() => String, { enum: ["user", "admin"], default: "user" })
  role!: Defaulted<"user" | "admin">;

  @Prop(() => String, { hidden: true })
  secret?: Hidden<string>;

  @Prop(() => [String])
  tags!: string[];

  @Prop(() => [Pet])
  pets!: Pet[];

  @Prop(() => Spec.map(Number))
  scores?: Map<string, number>;

  @Prop(() => BigInt)
  visits?: bigint;

  @Prop(() => Types.Decimal128)
  balance?: Decimal128;

  @Prop(() => Date, { nullable: true })
  lastSeen!: Date | null;
}

/** An order that refers to its buyer (a person). */
@Schema({ collection: "m_orders" })
export class Order extends Entity {
  @Prop(() => Types.ObjectId, { ref: () => Person, required: true })
  buyer!: Ref<Person>;

  @Prop(() => Number, { required: true, min: 0 })
  total!: number;

  @Prop(() => String, { enum: ["new", "paid", "shipped"], default: "new" })
  status!: Defaulted<"new" | "paid" | "shipped">;
}

/** The base of the `Circle` / `Square` discriminators. */
@Schema({ collection: "m_shapes" })
export class Shape extends Entity {
  @Prop(() => String, { required: true })
  label!: string;
}

/** A `Shape` discriminator with a radius. */
@Discriminator("circle")
export class Circle extends Shape {
  declare readonly __t: DiscriminatorValue<"circle">;
  @Prop(() => Number, { required: true })
  radius!: number;
}

/** A `Shape` discriminator with a side length. */
@Discriminator("square")
export class Square extends Shape {
  declare readonly __t: DiscriminatorValue<"square">;
  @Prop(() => Number, { required: true })
  side!: number;
}

/** A named counter for the atomic-update tests. */
@Schema({ collection: "m_counters" })
export class Counter extends Entity {
  @Prop(() => String, { required: true })
  key!: string;

  @Prop(() => Number, { required: true })
  value!: number;
}
