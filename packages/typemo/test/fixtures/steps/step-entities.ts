/*
 * Models for the pipeline steps and policies — `dbName` aliases at every level, hidden fields,
 * immutable fields, defaults, validators with a captured context, timestamps and a version key,
 * int32/int64/Decimal128, Maps, arrays of subdocuments, discriminators.
 */
import type { Decimal128 } from "mongodb";
import {
  type Defaulted,
  Discriminator,
  type DiscriminatorValue,
  Entity,
  type Hidden,
  type Immutable,
  Prop,
  Schema,
  Spec,
  Timestamped,
  Types,
  type ValidationContext,
  Versioned,
} from "../../../src/index.ts";

/** Every context a user validator of the fixtures received (tests read and clear it). */
export const SEEN_CONTEXTS: ValidationContext[] = [];

/** An address subdocument: `city` is stored as `c`; `zip` is nullable. */
@Schema()
export class Addr {
  @Prop(() => String, { required: true, dbName: "c" })
  city!: string;

  @Prop(() => String, { nullable: true })
  zip!: string | null;
}

/** An item subdocument: `name` is stored as `n`; `qty` has a default and a minimum. */
@Schema()
export class Item extends Entity {
  @Prop(() => String, { required: true, dbName: "n" })
  name!: string;

  @Prop(() => Number, { default: 1, min: 1 })
  qty!: Defaulted<number>;

  @Prop(() => Number, { required: true, min: 0 })
  price!: number;
}

/**
 * The main entity: aliases at every level, a validator that records its context, an immutable lowercased
 * email, a hidden password, timestamps and a version key, and the number-like BSON types.
 */
@Schema({ collection: "s_accounts" })
export class Account extends Versioned(Timestamped(Entity)) {
  @Prop(() => String, {
    required: true,
    dbName: "nm",
    trim: true,
    validate: (value: string, context: ValidationContext) => {
      SEEN_CONTEXTS.push(context);
      return value !== "forbidden" || "this name is forbidden";
    },
  })
  name!: string;

  @Prop(() => String, { required: true, immutable: true, lowercase: true })
  email!: Immutable<string>;

  @Prop(() => String, { hidden: true, dbName: "pw" })
  password?: Hidden<string>;

  @Prop(() => Number, { min: 0, max: 150 })
  age?: number;

  @Prop(() => Types.Int32)
  level?: number;

  @Prop(() => String, { enum: ["free", "pro"], default: "free" })
  plan!: Defaulted<"free" | "pro">;

  @Prop(() => BigInt)
  visits?: bigint;

  @Prop(() => Types.Decimal128)
  balance?: Decimal128;

  @Prop(() => [String], { dbName: "tg" })
  tags!: string[];

  @Prop(() => [Item], { dbName: "its" })
  items!: Item[];

  @Prop(() => Addr, { dbName: "ad" })
  address?: Addr;

  @Prop(() => Spec.map(Number), { dbName: "sc" })
  scores?: Map<string, number>;

  @Prop(() => Date, { nullable: true })
  lastLogin?: Date | null;
}

/** A plain entity with a hidden field: the `$lookup` target of `Account`. */
@Schema({ collection: "s_plain" })
export class Plain extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number)
  n?: number;

  @Prop(() => String, { hidden: true })
  secret?: Hidden<string>;
}

/** The base of the `Click` / `View` discriminators (key `kind`). */
@Schema({ collection: "s_events", discriminatorKey: "kind" })
export class Event extends Entity {
  @Prop(() => String, { required: true })
  kind!: string;

  @Prop(() => Date, { required: true })
  at!: Date;
}

/** An `Event` discriminator with an aliased url. */
@Discriminator("click")
export class Click extends Event {
  declare readonly kind: DiscriminatorValue<"click">;
  @Prop(() => String, { required: true, dbName: "u" })
  url!: string;
}

/** An `Event` discriminator with a duration in milliseconds. */
@Discriminator("view")
export class View extends Event {
  declare readonly kind: DiscriminatorValue<"view">;
  @Prop(() => Number, { required: true })
  ms!: number;
}
