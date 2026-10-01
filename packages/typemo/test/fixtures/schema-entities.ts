/*
 * Shared schema fixtures: a small but complete model graph used by unit, runtime, shape and hover tests.
 * `SCHEMA_ENTITIES_IMPORT` is the import of these classes as a string for the type probe (shape and hover tests).
 */
import { Decimal128, ObjectId, UUID } from "mongodb";
import {
  type Computed,
  type Defaulted,
  Discriminator,
  type DiscriminatorValue,
  Entity,
  type Hidden,
  type Immutable,
  Index,
  Prop,
  type Ref,
  Schema,
  Spec,
  Timestamped,
  Versioned,
  Virtual,
  type VirtualRef,
} from "../../src/index.ts";

/** A person's name, stored as a nested (dotted-path) object; `first` is trimmed. */
@Schema({ nested: true })
export class PersonName {
  @Prop(() => String, { required: true, trim: true })
  first!: string;

  @Prop(() => String)
  last?: string;
}

/** An address subdocument with a compound index and a nullable zip code. */
@Index({ city: 1, zip: 1 })
@Schema()
export class Address {
  @Prop(() => String, { required: true, index: true })
  city!: string;

  @Prop(() => String, { nullable: true })
  zip!: string | null;
}

/** The base of the `Circle` / `Square` discriminators; the discriminator key is `kind`. */
@Schema({ discriminatorKey: "kind" })
export class Shape {
  @Prop(() => String, { required: true })
  kind!: string;

  @Prop(() => String)
  label?: string;
}

/** A discriminator of `Shape` with a radius. */
@Discriminator("circle")
export class Circle extends Shape {
  declare readonly kind: DiscriminatorValue<"circle">;
  @Prop(() => Number, { required: true, min: 0 })
  radius!: number;
}

/** A discriminator of `Shape` with a side length. */
@Discriminator("square")
export class Square extends Shape {
  declare readonly kind: DiscriminatorValue<"square">;
  @Prop(() => Number, { required: true, min: 0 })
  side!: number;
}

/**
 * The main entity: timestamps and versioning mixins, a nested name, subdocument arrays, a Map, a
 * self-reference, an immutable UUID, a hidden field, a discriminated array and a populate virtual.
 */
@Index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $exists: true } } })
@Schema({ collection: "people" })
export class Person extends Versioned(Timestamped(Entity)) {
  @Prop(() => PersonName, { required: true })
  name!: PersonName;

  @Prop(() => String, { lowercase: true, match: /^[^@]+@[^@]+$/ })
  email?: string;

  @Prop(() => Number, { default: 0, min: 0, max: 150 })
  age!: Defaulted<number>;

  @Prop(() => String, { enum: ["admin", "user"], default: "user" })
  role!: Defaulted<"admin" | "user">;

  @Prop(() => [String], { default: [] })
  tags!: Defaulted<string[]>;

  @Prop(() => [Address])
  addresses?: Address[];

  @Prop(() => Spec.map(Number))
  scores?: Map<string, number>;

  @Prop(() => ObjectId, { ref: () => Person, nullable: true })
  manager!: Ref<Person> | null;

  @Prop(() => UUID, { immutable: true })
  externalId?: Immutable<UUID>;

  @Prop(() => Decimal128)
  balance?: Decimal128;

  @Prop(() => BigInt)
  visits?: bigint;

  @Prop(() => String, { hidden: true })
  passwordHash?: Hidden<string>;

  @Prop(() => [Shape])
  shapes?: (Circle | Square)[];

  @Virtual({ ref: () => Post, localField: "_id", foreignField: "author" })
  posts!: VirtualRef<Post>;

  get displayName(): Computed<string> {
    /* cast: brands the string as Computed */
    return `${this.name.first} ${this.name.last ?? ""}`.trim() as Computed<string>;
  }
}

/** A post with text-indexed fields, a TTL date and a reference to its author (a `Person`). */
@Schema()
export class Post extends Entity {
  @Prop(() => String, { required: true, text: true })
  title!: string;

  @Prop(() => String, { text: true })
  body?: string;

  @Prop(() => ObjectId, { ref: () => Person, required: true, index: true })
  author!: Ref<Person>;

  @Prop(() => Date, { expires: 3600 })
  expiresAt?: Date;
}

/** The fixtures as source text, for the type probe (compiled as a virtual file next to this one). */
export const SCHEMA_ENTITIES_IMPORT = `import { Person, Post, Address, PersonName, Shape, Circle, Square } from "./schema-entities.ts";`;
