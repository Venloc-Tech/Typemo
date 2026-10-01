/*
 * Storage fixtures: collections with every option, indexes to sync, a discriminator
 * hierarchy with pre/post images for change streams, an aliased entity, a keyset entity, a view class and a
 * materialized target. Collection names start with `s9_`.
 */
import {
  type Defaulted,
  Discriminator,
  type DiscriminatorValue,
  Entity,
  type Hidden,
  Index,
  Prop,
  Schema,
  SearchIndex,
} from "../../../src/index.ts";

/** A capped collection (4096 bytes, 3 documents). */
@Schema({ collection: "s9_logs", capped: { size: 4096, max: 3 } })
export class CappedLog extends Entity {
  @Prop(() => String, { required: true })
  line!: string;
}

/** A time-series collection with a meta field and an expiry. */
@Schema({
  collection: "s9_readings",
  timeseries: { timeField: "at", metaField: "sensor", granularity: "seconds", expireAfterSeconds: 3600 },
})
export class Reading extends Entity {
  @Prop(() => Date, { required: true })
  at!: Date;

  @Prop(() => String, { required: true })
  sensor!: string;

  @Prop(() => Number, { required: true })
  value!: number;
}

/** A clustered collection keyed by a date `_id`, with an expiry. */
@Schema({ collection: "s9_events", clustered: { name: "by_time", expireAfterSeconds: 60 } })
export class TimedEvent {
  @Prop(() => Date, { required: true })
  _id!: Date;

  @Prop(() => String, { required: true })
  kind!: string;
}

/** A collection with a server-side JSON Schema validator generated from the class. */
@Schema({ collection: "s9_validated", validator: true })
export class Validated extends Entity {
  @Prop(() => String, { required: true, minLength: 2 })
  name!: string;

  @Prop(() => Number, { min: 0 })
  age?: number;
}

/** A collection with a default collation; one index overrides it with the simple collation. */
@Schema({ collection: "s9_collated", collation: { locale: "en", strength: 2 } })
@Index({ name: 1 })
@Index({ code: 1 }, { collation: { locale: "simple" } })
export class Collated extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String)
  code?: string;
}

/** A collection that stores change-stream pre and post images. */
@Schema({ collection: "s9_imaged", changeStreamPreAndPostImages: true })
export class Imaged extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => Number, { required: true })
  n!: number;
}

/** Indexes of every kind the sync compares. */
@Schema({ collection: "s9_indexed" })
@Index({ email: 1 }, { unique: true })
@Index({ nick: 1 }, { collation: { locale: "en", strength: 2 } })
@Index({ city: 1 }, { hidden: true })
@Index({ seenAt: 1 }, { expireAfterSeconds: 300 })
@Index({ bio: "text" })
export class Indexed extends Entity {
  @Prop(() => String, { required: true })
  email!: string;

  @Prop(() => String)
  nick?: string;

  @Prop(() => String)
  city?: string;

  @Prop(() => Date)
  seenAt?: Date;

  @Prop(() => String)
  bio?: string;
}

/** A search index (Atlas Search): a plain mongod cannot create it. */
@Schema({ collection: "s9_searchable" })
@SearchIndex({ name: "default", definition: { mappings: { dynamic: true } } })
export class Searchable extends Entity {
  @Prop(() => String, { required: true })
  text!: string;
}

/** The base of the `Dog` / `Cat` discriminators, with a hidden field. */
@Schema({ collection: "s9_animals", changeStreamPreAndPostImages: true })
export class Animal extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String, { hidden: true })
  secret?: Hidden<string>;
}

/** An `Animal` discriminator that barks. */
@Discriminator("dog")
export class Dog extends Animal {
  declare readonly __t: DiscriminatorValue<"dog">;
  @Prop(() => Boolean, { required: true })
  barks!: boolean;
}

/** An `Animal` discriminator with a number of lives. */
@Discriminator("cat")
export class Cat extends Animal {
  declare readonly __t: DiscriminatorValue<"cat">;
  @Prop(() => Number, { required: true })
  lives!: number;
}

/** A subdocument whose `city` is stored under another name (`c`). */
@Schema()
export class Address {
  @Prop(() => String, { required: true, dbName: "c" })
  city!: string;
}

/** An entity whose fields are stored under other names (`dbName`), also inside a subdocument. */
@Schema({ collection: "s9_aliased" })
export class AliasedDoc extends Entity {
  @Prop(() => String, { required: true, dbName: "t" })
  title!: string;

  @Prop(() => Address)
  address?: Address;

  @Prop(() => Number, { dbName: "n" })
  count?: number;
}

/** An entity for keyset pagination and views: a date, a score, a bigint, a nullable rank and a defaulted state. */
@Schema({ collection: "s9_articles" })
@Index({ publishedAt: -1, _id: -1 })
export class Article extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Date, { required: true })
  publishedAt!: Date;

  @Prop(() => Number, { required: true })
  score!: number;

  @Prop(() => BigInt, { required: true })
  views!: bigint;

  @Prop(() => String)
  subtitle?: string;

  @Prop(() => Number, { nullable: true })
  rank!: number | null;

  @Prop(() => String, { enum: ["draft", "live"], default: "live" })
  state!: Defaulted<"draft" | "live">;
}

/** A view class: rows of `s9_articles` with a high score. */
@Schema({ collection: "s9_top_articles" })
export class TopArticle extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number, { required: true })
  score!: number;
}

/** A materialized target: totals per state. */
@Schema({ collection: "s9_state_totals" })
export class StateTotal {
  @Prop(() => String, { required: true })
  _id!: string;

  @Prop(() => Number, { required: true })
  total!: number;

  @Prop(() => Number, { required: true })
  count!: number;
}

/** A materialized target merged on a unique field other than `_id`. */
@Schema({ collection: "s9_title_scores" })
@Index({ title: 1 }, { unique: true })
export class TitleScore extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number, { required: true })
  score!: number;
}

/** Two unique indexes: both fail on duplicated data (the sync collects every failure). */
@Schema({ collection: "s9_two_unique" })
@Index({ a: 1 }, { unique: true })
@Index({ b: 1 }, { unique: true })
export class TwoUnique extends Entity {
  @Prop(() => String)
  a?: string;

  @Prop(() => String)
  b?: string;
}

/** An index with plain options: the server's `unique: false` / `sparse: false` equal "absent". */
@Schema({ collection: "s9_plain_indexed" })
@Index({ code: 1 })
export class PlainIndexed extends Entity {
  @Prop(() => String)
  code?: string;
}

/** A view class over `Animal` (which has a Hidden field): the rows must not carry it. */
@Schema({ collection: "s9_animal_names" })
export class AnimalName extends Entity {
  @Prop(() => String, { required: true })
  name!: string;
}
