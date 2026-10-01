/*
 * A small decorated model graph for the query tests (unit, runtime, shape, ported, regressions).
 * `Member ↔ Article ↔ Note`: refs both ways, a virtual, Hidden fields at the top
 * and inside a subdocument, Maps of scalars and of subdocuments, an embedded discriminated union,
 * nullable and optional fields, int64 (`bigint`), Decimal128, a GeoJSON point.
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
  type Ref,
  Schema,
  Spec,
  Types,
  Virtual,
  type VirtualRef,
} from "../../../src/index.ts";

/** A GeoJSON point. */
@Schema()
export class GeoPoint {
  @Prop(() => String, { required: true, enum: ["Point"] })
  type!: "Point";

  @Prop(() => [Number], { required: true })
  coordinates!: number[];
}

/** An address with a nullable zip and an optional point. */
@Schema()
export class Address {
  @Prop(() => String, { required: true })
  city!: string;

  @Prop(() => String, { nullable: true })
  zip!: string | null;

  @Prop(() => GeoPoint)
  geo?: GeoPoint;
}

/** A link with a defaulted click counter. */
@Schema()
export class Link {
  @Prop(() => String, { required: true })
  url!: string;

  @Prop(() => Number, { default: 0 })
  clicks!: Defaulted<number>;
}

/** A profile: an address, links and a hidden note inside a subdocument. */
@Schema()
export class Profile {
  @Prop(() => String)
  bio?: string;

  @Prop(() => Address)
  address?: Address;

  @Prop(() => [Link])
  links!: Link[];

  @Prop(() => String, { hidden: true })
  secretNote?: Hidden<string>;
}

/** A badge: the value of a Map of subdocuments on `Member`. */
@Schema()
export class Badge {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number)
  level?: number;
}

/** A member with every field kind the query tests need (see the file header). */
@Schema({ collection: "q_members" })
export class Member extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String, { required: true, immutable: true })
  email!: Immutable<string>;

  @Prop(() => String, { hidden: true })
  passwordHash?: Hidden<string>;

  @Prop(() => String, { enum: ["user", "editor", "admin"], default: "user" })
  role!: Defaulted<"user" | "editor" | "admin">;

  @Prop(() => Number)
  age?: number;

  @Prop(() => String)
  nickname?: string;

  @Prop(() => String)
  handle?: string;

  @Prop(() => BigInt)
  visits?: bigint;

  @Prop(() => Types.Decimal128)
  balance?: Decimal128;

  @Prop(() => Boolean)
  active?: boolean;

  @Prop(() => [String])
  tags!: string[];

  @Prop(() => Profile)
  profile?: Profile;

  @Prop(() => Spec.map(Number))
  counters?: Map<string, number>;

  @Prop(() => Spec.map(Badge))
  badges?: Map<string, Badge>;

  @Prop(() => Types.ObjectId, { ref: () => Member, nullable: true })
  bestFriend?: Ref<Member> | null;

  @Prop(() => [Types.ObjectId], { ref: () => Article })
  favorites?: Ref<Article>[];

  @Prop(() => Date, { nullable: true })
  lastLogin?: Date | null;
}

/** The base of the embedded `TextBlock` / `ImageBlock` discriminators (key `kind`). */
@Schema({ discriminatorKey: "kind" })
export class Block {
  @Prop(() => String, { required: true })
  kind!: string;
}

/** A `Block` discriminator holding text. */
@Discriminator("text")
export class TextBlock extends Block {
  declare readonly kind: DiscriminatorValue<"text">;
  @Prop(() => String, { required: true })
  text!: string;
}

/** A `Block` discriminator holding an image url and an optional width. */
@Discriminator("image")
export class ImageBlock extends Block {
  declare readonly kind: DiscriminatorValue<"image">;
  @Prop(() => String, { required: true })
  url!: string;

  @Prop(() => Number)
  width?: number;
}

/** A revision of an article, with a numeric array (an array inside an array element). */
@Schema()
export class Revision {
  @Prop(() => String)
  note?: string;

  @Prop(() => Number, { required: true })
  lines!: number;

  @Prop(() => [Number])
  scores!: number[];
}

/** An article: an author reference, revisions, discriminated blocks and a `notes` populate virtual. */
@Schema({ collection: "q_articles" })
export class Article extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Types.ObjectId, { ref: () => Member, required: true })
  author!: Ref<Member>;

  @Prop(() => [Revision])
  revisions!: Revision[];

  @Prop(() => [Block])
  blocks!: (TextBlock | ImageBlock)[];

  @Prop(() => [String])
  tags!: string[];

  @Prop(() => Number, { default: 0 })
  views!: Defaulted<number>;

  @Prop(() => Date, { nullable: true })
  publishedAt!: Date | null;

  @Virtual({ ref: () => Note, localField: "_id", foreignField: "article" })
  readonly notes?: VirtualRef<Note>;
}

/** A note that refers to an article. */
@Schema({ collection: "q_notes" })
export class Note extends Entity {
  @Prop(() => String, { required: true })
  body!: string;

  @Prop(() => Types.ObjectId, { ref: () => Article, required: true })
  article!: Ref<Article>;

  @Prop(() => Number, { required: true })
  score!: number;
}

/** The same imports as source text, for the type probe (hover and shape tests). */
export const QUERY_ENTITIES_IMPORT = `import { Member, Article, Note, Profile, Address, Badge, Revision, TextBlock, ImageBlock, Block, GeoPoint, Link } from "./query/query-entities.ts";`;
