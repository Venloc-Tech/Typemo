import { type Defaulted, Entity, Index, Prop, Schema, Types } from "@venloc/typemo";
import type { Document } from "mongodb";
import type { Rng } from "../rng.ts";
import { ShapeDef } from "./shape-def.ts";

/** The author of a medium document. */
@Schema({ nested: true })
export class MediumAuthor {
  @Prop(() => String, { required: true }) first!: string;
  @Prop(() => String) last?: string;
  @Prop(() => String) email?: string;
}

/** A latitude and longitude. */
@Schema({ nested: true })
export class MediumGeo {
  @Prop(() => Number, { required: true, min: -90, max: 90 }) lat!: number;
  @Prop(() => Number, { required: true, min: -180, max: 180 }) lng!: number;
}

/** A postal address with a location. */
@Schema({ nested: true })
export class MediumAddress {
  @Prop(() => String) street?: string;
  @Prop(() => String, { required: true }) city!: string;
  @Prop(() => String) zip?: string;
  @Prop(() => String) country?: string;
  @Prop(() => MediumGeo) geo?: MediumGeo;
}

/** Engagement counters. */
@Schema({ nested: true })
export class MediumStats {
  @Prop(() => Number, { min: 0 }) likes?: number;
  @Prop(() => Number, { min: 0 }) shares?: number;
  @Prop(() => Number, { min: 0 }) comments?: number;
}

/** Display flags. */
@Schema({ nested: true })
export class MediumFlags {
  @Prop(() => Boolean) featured?: boolean;
  @Prop(() => Boolean) pinned?: boolean;
}

/** The allowed values of `MediumDoc.status`. */
export const MEDIUM_STATUSES = ["draft", "published", "archived"] as const;

/** A medium document: about 25 fields, nested objects, validators and two defaults. */
@Index({ status: 1, priority: -1 })
@Schema({ collection: "bench_medium" })
export class MediumDoc extends Entity {
  @Prop(() => String, { required: true, maxLength: 200 }) title!: string;
  @Prop(() => String, { required: true, unique: true }) slug!: string;
  @Prop(() => String, { required: true, enum: ["draft", "published", "archived"] }) status!:
    | "draft"
    | "published"
    | "archived";
  @Prop(() => Number, { required: true, min: 0, max: 10 }) priority!: number;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => Number, { default: 0, min: 0 }) views!: Defaulted<number>;
  @Prop(() => Number, { min: 0, max: 5 }) rating?: number;
  @Prop(() => Boolean, { required: true }) published!: boolean;
  @Prop(() => Date) publishedAt?: Date;
  @Prop(() => MediumAuthor, { required: true }) author!: MediumAuthor;
  @Prop(() => MediumAddress) address?: MediumAddress;
  @Prop(() => MediumStats) stats?: MediumStats;
  @Prop(() => MediumFlags) flags?: MediumFlags;
  @Prop(() => String) notes?: string;
  @Prop(() => String) category?: string;
  @Prop(() => String, { default: "en" }) language!: Defaulted<string>;
  @Prop(() => Number) revision?: number;
  @Prop(() => Types.ObjectId) sourceId?: Types.ObjectId;
}

/**
 * Generates the input of one medium document.
 *
 * @param i - The document index.
 * @param rng - The random source seeded for this document.
 * @returns The input document.
 */
const generate = (i: number, rng: Rng): Document => ({
  title: rng.words(rng.int(3, 8)),
  slug: `post-${i}`,
  status: rng.pick(MEDIUM_STATUSES),
  priority: rng.int(0, 10),
  tags: [rng.word(), rng.word(), rng.word()],
  rating: rng.int(0, 5),
  published: rng.bool(),
  publishedAt: rng.date(),
  author: { first: rng.word(), last: rng.word(), email: `a${i}@bench.test` },
  address: {
    street: `${rng.int(1, 999)} ${rng.word()} st`,
    city: rng.word(),
    zip: String(rng.int(10000, 99999)),
    country: rng.pick(["US", "DE", "FR", "JP", "BR"]),
    geo: { lat: rng.money(-80, 80), lng: rng.money(-170, 170) },
  },
  stats: { likes: rng.int(0, 5000), shares: rng.int(0, 500), comments: rng.int(0, 300) },
  flags: { featured: rng.bool(), pinned: rng.bool() },
  notes: rng.words(12),
  category: rng.word(),
  revision: rng.int(1, 20),
});

/** Shape 2:~25 fields, nested objects, validators and two defaults (`views`, `language`). */
export const MEDIUM = new ShapeDef<MediumDoc>({
  name: "medium",
  namespace: 0x0e0d1002,
  collection: "bench_medium",
  entity: MediumDoc,
  mongooseName: "BenchMedium",
  mongooseSchema: (m) =>
    new m.Schema(
      {
        title: { type: String, required: true, maxLength: 200 },
        slug: { type: String, required: true, unique: true },
        status: { type: String, required: true, enum: MEDIUM_STATUSES },
        priority: { type: Number, required: true, min: 0, max: 10 },
        tags: [String],
        views: { type: Number, default: 0, min: 0 },
        rating: { type: Number, min: 0, max: 5 },
        published: { type: Boolean, required: true },
        publishedAt: Date,
        author: {
          first: { type: String, required: true },
          last: String,
          email: String,
        },
        address: {
          street: String,
          city: { type: String, required: true },
          zip: String,
          country: String,
          geo: {
            lat: { type: Number, required: true, min: -90, max: 90 },
            lng: { type: Number, required: true, min: -180, max: 180 },
          },
        },
        stats: {
          likes: { type: Number, min: 0 },
          shares: { type: Number, min: 0 },
          comments: { type: Number, min: 0 },
        },
        flags: { featured: Boolean, pinned: Boolean },
        notes: String,
        category: String,
        language: { type: String, default: "en" },
        revision: Number,
        sourceId: m.Schema.Types.ObjectId,
      },
      /* minimize: false — Typemo never minimizes; equal DB state needs the same rule. */
      { versionKey: false, minimize: false },
    ).index({ status: 1, priority: -1 }),
  indexes: [{ keys: { slug: 1 }, options: { unique: true } }, { keys: { status: 1, priority: -1 } }],
  generate,
  complete: (input) => ({ ...input, views: 0, language: "en" }),
});
