import { UUID } from "mongodb";
import {
  type Defaulted,
  Entity,
  EntityWithId,
  Prop,
  type Ref,
  Schema,
  Timestamped,
  Types,
  Versioned,
} from "../../../src/index.ts";

/*
 * Entities whose `_id` is not an ObjectId, declared through `EntityWithId` (a string, a generated string, a
 * UUID, a number, composed with the timestamp and version mixins), and a model that refers to them.
 */

/** A country: its ISO code is the id and is required. */
@Schema({ collection: "w5_countries" })
export class Country extends EntityWithId(() => String) {
  @Prop(() => String, { required: true })
  name!: string;
}

/** A session: a UUID generated when absent, with timestamps and a version. */
@Schema({ collection: "w5_sessions" })
export class Session extends Versioned(Timestamped(EntityWithId(() => Types.UUID, { default: () => new UUID() }))) {
  @Prop(() => String, { required: true })
  user!: string;
}

/** A counter: a number id chosen by the caller. */
@Schema({ collection: "w5_counters" })
export class Counter extends EntityWithId(() => Number) {
  @Prop(() => Number, { required: true, default: 0 })
  hits!: Defaulted<number>;
}

/** A tag with a generated string id. */
@Schema({ collection: "w5_tags" })
export class Tag extends EntityWithId(() => String, { default: () => `tag-${Math.random().toString(36).slice(2)}` }) {
  @Prop(() => String, { required: true })
  label!: string;
}

/** A city that refers to a country by its string id and to sessions by UUID. */
@Schema({ collection: "w5_cities" })
export class City extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String, { ref: () => Country })
  country?: Ref<Country, string>;

  @Prop(() => [Types.UUID], { ref: () => Session })
  visitors!: Ref<Session, UUID>[];
}

/** The materialized result of a count per country: a `$out` / `$merge` target with a string id. */
@Schema({ collection: "w5_country_totals" })
export class CountryTotal extends EntityWithId(() => String) {
  @Prop(() => Number, { required: true })
  cities!: number;
}
