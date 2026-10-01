/*
 * The dense-graph project of the compiler budget (see VERSIONS.md): `User ↔ Post ↔ Comment`
 * with cycles, embedded depth 5–7, arrays of subdocuments, Maps (of scalars, of subdocuments, of refs),
 * an embedded union, a discriminator hierarchy, virtuals. Type-only (no decorators): the budget
 * measures the query types, the cost of `@Prop` is measured separately.
 */
import type { Computed, Defaulted, Hidden, Immutable, Ref, VirtualRef, VirtualValue } from "@venloc/typemo";
import type { ObjectId } from "mongodb";

/** Hours in which push notifications are muted. */
export class QuietHours {
  from!: number;
  to!: number;
  timezone?: string;
}

/** Push notification settings (embedded depth 4). */
export class PushSettings {
  enabled!: boolean;
  quietHours!: QuietHours;
}

/** Notification channels of a user. */
export class NotificationSettings {
  email!: boolean;
  push!: PushSettings;
}

/** Display and notification preferences. */
export class Settings {
  theme!: Defaulted<"light" | "dark">;
  language!: string;
  notifications!: NotificationSettings;
}

/** A GeoJSON point. */
export class GeoPoint {
  type!: "Point";
  coordinates!: number[];
}

/** A postal address with an optional location. */
export class Address {
  street!: string;
  city!: string;
  zip?: string | null;
  geo?: GeoPoint;
}

/** A link on a profile. */
export class Link {
  label!: string;
  url!: string;
  clicks!: Defaulted<number>;
}

/** The embedded profile of a user. */
export class Profile {
  bio?: string;
  address!: Address;
  links!: Link[];
  settings!: Settings;
}

/** A badge awarded to a user; the value type of a Map of subdocuments. */
export class Badge {
  title!: string;
  awardedAt!: Date;
  awardedBy?: Ref<User>;
}

/** The user entity: cycles with posts and comments, Maps, virtuals and hidden fields. */
export class User {
  _id!: Defaulted<Immutable<ObjectId>>;
  name!: string;
  email!: Immutable<string>;
  passwordHash!: Hidden<string>;
  role!: Defaulted<"user" | "editor" | "admin">;
  age?: number;
  visits!: Defaulted<bigint>;
  active!: Defaulted<boolean>;
  createdAt!: Defaulted<Immutable<Date>>;
  profile!: Profile;
  tags!: string[];
  posts!: Ref<Post>[];
  bestFriend!: Ref<User> | null;
  followers!: Ref<User>[];
  pinnedComment?: Ref<Comment> | null;
  counters!: Map<string, number>;
  badges!: Map<string, Badge>;
  readonly commentsByUser?: VirtualRef<Comment>;
  readonly postCount?: VirtualRef<Post, false, true>;

  /** A computed, read-only value. */
  get displayName(): Computed<string> {
    return `${this.name}` as Computed<string>;
  }

  /** A virtual with a getter. */
  get initials(): VirtualValue<string> {
    return this.name.slice(0, 2) as VirtualValue<string>;
  }

  /** A virtual with a setter. */
  set initials(value: string) {
    this.name = value;
  }

  /**
   * A method, which is not data.
   *
   * @returns A greeting.
   */
  greet(): string {
    return `hi ${this.name}`;
  }
}

/** A file touched by a revision. */
export class DiffFile {
  path!: string;
  lines!: number;
}

/** The change summary of a revision. */
export class Diff {
  added!: number;
  removed!: number;
  files!: DiffFile[];
}

/** One revision of a post. */
export class Revision {
  editor!: Ref<User>;
  at!: Date;
  note?: string;
  diff!: Diff;
}

/** A text block of a post. */
export class TextBlock {
  kind!: "text";
  text!: string;
}

/** Pixel size of an image. */
export class ImageSize {
  width!: number;
  height!: number;
}

/** An image block of a post. */
export class ImageBlock {
  kind!: "image";
  url!: string;
  caption?: string;
  size!: ImageSize;
}

/** An embedded-media block of a post. */
export class EmbedBlock {
  kind!: "embed";
  provider!: "youtube" | "vimeo";
  post?: Ref<Post>;
}

/**
 * The embedded union of post blocks.
 *
 * @example
 * ```ts
 * const block: Block = { kind: "text", text: "hello" };
 * ```
 */
export type Block = TextBlock | ImageBlock | EmbedBlock;

/** The card style of an Open Graph preview. */
export class OgCard {
  type!: "summary" | "large";
  site?: string;
}

/** Open Graph data. */
export class Og {
  image?: string;
  card!: OgCard;
}

/** Search-engine metadata. */
export class Seo {
  title!: string;
  keywords!: string[];
  og!: Og;
}

/** Counters and metadata of a post (embedded depth 7 through `seo.og.card`). */
export class PostMeta {
  views!: Defaulted<number>;
  likes!: Defaulted<number>;
  seo!: Seo;
}

/** The post entity. */
export class Post {
  _id!: Defaulted<Immutable<ObjectId>>;
  title!: string;
  slug!: Immutable<string>;
  status!: Defaulted<"draft" | "published" | "archived">;
  author!: Ref<User>;
  coAuthors!: Ref<User>[];
  comments!: Ref<Comment>[];
  related!: Ref<Post>[];
  revisions!: Revision[];
  blocks!: Block[];
  meta!: PostMeta;
  publishedAt!: Date | null;
  tags!: string[];
  reactions!: Map<string, number>;
  readonly topComment?: VirtualRef<Comment, true>;
}

/** A reaction to a comment. */
export class Reaction {
  user!: Ref<User>;
  kind!: "like" | "love" | "angry";
  at!: Date;
}

/** The comment entity: a self-reference through `parent` and `replies`. */
export class Comment {
  _id!: Defaulted<Immutable<ObjectId>>;
  body!: string;
  author!: Ref<User>;
  post!: Ref<Post>;
  parent!: Ref<Comment> | null;
  replies!: Ref<Comment>[];
  reactions!: Reaction[];
  mentions!: Map<string, Ref<User>>;
  edited!: Defaulted<boolean>;
  score!: number;
}

/** Base of the discriminator hierarchy (one collection, `kind` key). */
export class Notification {
  _id!: Defaulted<Immutable<ObjectId>>;
  kind!: string;
  recipient!: Ref<User>;
  read!: Defaulted<boolean>;
  at!: Date;
}

/** A notification about a mention in a comment. */
export class MentionNotification extends Notification {
  declare kind: "mention";
  comment!: Ref<Comment>;
  excerpt!: string;
}

/** A notification about a new follower. */
export class FollowNotification extends Notification {
  declare kind: "follow";
  follower!: Ref<User>;
}
