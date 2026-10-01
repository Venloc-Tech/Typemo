/*
 * Performance fixtures: documents for the tests of the fast hydration, the plain forms, the retained memory of
 * a cursor and the perf guard (hydrate / toObject / populate of 1000 documents). `PerfMedium` mirrors the bench's
 * "medium" shape (nested objects, a scalar array, a date, defaults).
 */
import type { ObjectId } from "mongodb";
import { type Defaulted, Entity, Prop, type Ref, Schema, Types } from "../../../src/index.ts";

/** A nested date window. */
@Schema({ nested: true })
export class PerfWindow {
  @Prop(() => Date)
  from?: Date;

  @Prop(() => Date)
  to?: Date;
}

/** A line with a date: an array element of `PerfEvent`. */
@Schema()
export class PerfLine extends Entity {
  @Prop(() => String, { required: true })
  sku!: string;

  @Prop(() => Number, { required: true })
  qty!: number;

  @Prop(() => Date)
  at?: Date;
}

/** Dates at every depth, and an array of subdocuments whose length decides how changes are computed. */
@Schema({ collection: "perf_events" })
export class PerfEvent extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => Date)
  when?: Date;

  @Prop(() => PerfWindow)
  window?: PerfWindow;

  @Prop(() => [PerfLine])
  lines!: PerfLine[];

  @Prop(() => [String])
  tags!: string[];
}

/** A class whose constructor leaves own `undefined` fields (define semantics: hydration deletes them). */
@Schema({ collection: "perf_initialized" })
export class PerfInitialized extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => Number)
  score?: number;

  @Prop(() => String)
  note?: string;

  constructor() {
    super();
    /* what `useDefineForClassFields: true` does for a declared field: an own `undefined` property */
    for (const key of ["score", "note"]) {
      Object.defineProperty(this, key, { value: undefined, enumerable: true, writable: true, configurable: true });
    }
  }
}

/** A nested author name. */
@Schema({ nested: true })
export class PerfAuthorName {
  @Prop(() => String, { required: true })
  first!: string;

  @Prop(() => String)
  last?: string;

  @Prop(() => String)
  email?: string;
}

/** A nested latitude / longitude pair. */
@Schema({ nested: true })
export class PerfGeo {
  @Prop(() => Number, { required: true })
  lat!: number;

  @Prop(() => Number, { required: true })
  lng!: number;
}

/** A nested address that holds a `PerfGeo`. */
@Schema({ nested: true })
export class PerfAddress {
  @Prop(() => String)
  street?: string;

  @Prop(() => String, { required: true })
  city!: string;

  @Prop(() => String)
  zip?: string;

  @Prop(() => PerfGeo)
  geo?: PerfGeo;
}

/** Nested counters. */
@Schema({ nested: true })
export class PerfStats {
  @Prop(() => Number)
  likes?: number;

  @Prop(() => Number)
  shares?: number;
}

/** The bench's "medium" document, for the perf guard. */
@Schema({ collection: "perf_medium" })
export class PerfMedium extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number, { required: true })
  priority!: number;

  @Prop(() => [String])
  tags!: string[];

  @Prop(() => Number, { default: 0 })
  views!: Defaulted<number>;

  @Prop(() => Boolean, { required: true })
  published!: boolean;

  @Prop(() => Date)
  publishedAt?: Date;

  @Prop(() => PerfAuthorName, { required: true })
  author!: PerfAuthorName;

  @Prop(() => PerfAddress)
  address?: PerfAddress;

  @Prop(() => PerfStats)
  stats?: PerfStats;

  @Prop(() => String)
  notes?: string;

  @Prop(() => String)
  category?: string;

  @Prop(() => Types.ObjectId)
  sourceId?: ObjectId;
}

/** A writer: the populate target of `PerfArticle`. */
@Schema({ collection: "perf_writers" })
export class PerfWriter extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String)
  country?: string;
}

/** An article that refers to a writer. */
@Schema({ collection: "perf_articles" })
export class PerfArticle extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Types.ObjectId, { ref: () => PerfWriter })
  writer?: Ref<PerfWriter>;
}

/**
 * The stored form of medium document `i` (deterministic, no RNG).
 *
 * @param i - the ordinal of the document, which drives every generated value
 * @param _id - the `_id` to store
 * @returns the raw document as the driver would write it
 */
export const perfMediumRaw = (i: number, _id: ObjectId): Record<string, unknown> => ({
  _id,
  title: `title ${i} lorem ipsum dolor`,
  priority: i % 10,
  tags: [`t${i % 7}`, `t${i % 11}`, `t${i % 13}`],
  published: i % 2 === 0,
  publishedAt: new Date(1_700_000_000_000 + i * 1000),
  author: { first: `first${i}`, last: "last", email: `a${i}@perf.test` },
  address: { street: `${i} main st`, city: "Paris", zip: "75001", geo: { lat: 48.8, lng: 2.3 } },
  stats: { likes: i, shares: i % 5 },
  notes: `some notes for ${i}`,
  category: `c${i % 4}`,
});

/**
 * A nested object with a field renamed by `dbName`. Fields are renamed at the root, in a nested object and in
 * array elements; data stored before the rename still has the CODE name as its key.
 */
@Schema({ nested: true })
export class PerfRenamedInfo {
  @Prop(() => String, { dbName: "c" })
  city?: string;
}

/** An array element with a field renamed by `dbName`. */
@Schema()
export class PerfRenamedItem extends Entity {
  @Prop(() => String, { dbName: "l" })
  label?: string;

  @Prop(() => Number)
  qty?: number;
}

/** A root with renamed fields at the root, in a nested object and in array elements. */
@Schema({ collection: "perf_renamed" })
export class PerfRenamed extends Entity {
  @Prop(() => String, { dbName: "n" })
  name?: string;

  @Prop(() => Number)
  qty?: number;

  @Prop(() => PerfRenamedInfo)
  info?: PerfRenamedInfo;

  @Prop(() => [PerfRenamedItem])
  items?: PerfRenamedItem[];
}
