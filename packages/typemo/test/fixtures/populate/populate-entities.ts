/*
 * Populate fixtures: a model graph with every kind of populate —
 * single / array / nullable / self references, a Map of references, virtuals (many, justOne with a sort,
 * count, with its own match), references inside arrays of subdocuments, nested objects and Maps of
 * subdocuments, `refPath` and `refModel` (polymorphic), root discriminators (a reference on one of them,
 * H011), embedded discriminators, a virtual over UUID arrays (H129), `dbName` aliases on both sides
 * and a `Hidden` field of a target.
 */
import type { UUID } from "mongodb";
import {
  Discriminator,
  type DiscriminatorValue,
  Entity,
  type Hidden,
  Prop,
  type Ref,
  Schema,
  Spec,
  Types,
  Virtual,
  type VirtualRef,
} from "../../../src/index.ts";

/** A company with a hidden `secret`: a populate target. */
@Schema({ collection: "pp_companies" })
export class Company extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => Number)
  size?: number;

  @Prop(() => String, { hidden: true })
  secret?: Hidden<string>;
}

/** A tag: the target of arrays and of a Map of references. */
@Schema({ collection: "pp_tags" })
export class Tag extends Entity {
  @Prop(() => String, { required: true })
  label!: string;
}

/**
 * A person: single, nullable, self and array references, a Map of references, and populate virtuals
 * (many, justOne with a sort, count, with its own match).
 */
@Schema({ collection: "pp_people" })
export class Person extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => Number)
  age?: number;

  @Prop(() => Types.ObjectId, { ref: () => Company })
  company?: Ref<Company>;

  @Prop(() => Types.ObjectId, { ref: () => Person, nullable: true })
  mentor?: Ref<Person> | null;

  @Prop(() => [Types.ObjectId], { ref: () => Person })
  friends!: Ref<Person>[];

  @Prop(() => Spec.map(Types.ObjectId), { ref: () => Tag })
  tagsByTopic?: Map<string, Ref<Tag>>;

  @Virtual({ ref: () => Post, localField: "_id", foreignField: "author" })
  posts?: VirtualRef<Post>;

  @Virtual({
    ref: () => Post,
    localField: "_id",
    foreignField: "author",
    justOne: true,
    options: { sort: { views: -1 } },
  })
  topPost?: VirtualRef<Post, true>;

  @Virtual({ ref: () => Post, localField: "_id", foreignField: "author", count: true })
  postCount?: VirtualRef<Post, false, true>;

  @Virtual({ ref: () => Post, localField: "_id", foreignField: "author", match: { published: true } })
  publishedPosts?: VirtualRef<Post>;

  /** A method: hydrated documents keep the class's methods, lean ones do not. */
  greet(): string {
    return `hi ${this.name}`;
  }
}

/** A post: its author is stored under another name (`dbName: "a"`); it has a comments virtual. */
@Schema({ collection: "pp_posts" })
export class Post extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Types.ObjectId, { ref: () => Person, required: true, dbName: "a" })
  author!: Ref<Person>;

  @Prop(() => [Types.ObjectId], { ref: () => Tag })
  tags!: Ref<Tag>[];

  @Prop(() => Number, { required: true })
  views!: number;

  @Prop(() => Boolean, { required: true })
  published!: boolean;

  @Virtual({ ref: () => Comment, localField: "_id", foreignField: "post" })
  comments?: VirtualRef<Comment>;
}

/** A comment that refers to a post and to a person: nested (dotted) populate. */
@Schema({ collection: "pp_comments" })
export class Comment extends Entity {
  @Prop(() => String, { required: true })
  body!: string;

  @Prop(() => Types.ObjectId, { ref: () => Post, required: true })
  post!: Ref<Post>;

  @Prop(() => Types.ObjectId, { ref: () => Person, required: true })
  author!: Ref<Person>;
}

/** A product whose name is stored under another name (`dbName: "n"`). */
@Schema({ collection: "pp_products" })
export class Product extends Entity {
  @Prop(() => String, { required: true, dbName: "n" })
  name!: string;

  @Prop(() => Number, { required: true })
  price!: number;
}

/** An order line: a reference to a product and a quantity (a subdocument in an array). */
@Schema()
export class Line {
  @Prop(() => Types.ObjectId, { ref: () => Product, required: true })
  product!: Ref<Product>;

  @Prop(() => Number, { required: true })
  qty!: number;
}

/** A nested (dotted-path) object with a reference to a carrier company. */
@Schema({ nested: true })
export class Shipping {
  @Prop(() => String, { required: true })
  city!: string;

  @Prop(() => Types.ObjectId, { ref: () => Company })
  carrier?: Ref<Company>;
}

/** A note with an optional author reference; the value of a Map of subdocuments. */
@Schema()
export class Note {
  @Prop(() => String, { required: true })
  text!: string;

  @Prop(() => Types.ObjectId, { ref: () => Person })
  author?: Ref<Person>;
}

/** An order: references inside arrays of subdocuments, a nested object, and Maps of references and subdocuments. */
@Schema({ collection: "pp_orders" })
export class Order extends Entity {
  @Prop(() => Types.ObjectId, { ref: () => Person, required: true })
  customer!: Ref<Person>;

  @Prop(() => [Line])
  lines!: Line[];

  @Prop(() => Shipping)
  shipping?: Shipping;

  @Prop(() => Spec.map(Types.ObjectId), { ref: () => Product })
  extras?: Map<string, Ref<Product>>;

  @Prop(() => Spec.map(Note))
  notes?: Map<string, Note>;
}

/** The model a `refModel` reference picks: by the `kind` of the (sub)document that holds it. */
export class Kinds {
  /**
   * Picks the model a reference points to.
   *
   * @param owner - the (sub)document that holds the reference
   * @returns `Comment` when its `kind` is `"Comment"`, else `Post`
   */
  static pick(owner: object): typeof Post | typeof Comment {
    /* cast: the owner is any object; only its optional `kind` is read */
    return (owner as { readonly kind?: unknown }).kind === "Comment" ? Comment : Post;
  }
}

/** An activity with a polymorphic reference by `refPath` (the `kind` field) and by `refModel`. */
@Schema({ collection: "pp_activities" })
export class Activity extends Entity {
  @Prop(() => String, { required: true, enum: ["Post", "Comment"] })
  kind!: "Post" | "Comment";

  @Prop(() => Types.ObjectId, { refPath: "kind", required: true })
  target!: Ref<Post | Comment>;

  @Prop(() => Types.ObjectId, { refModel: Kinds.pick })
  subject?: Ref<Post | Comment>;
}

/** The base of the `Signup` / `Purchase` root discriminators. */
@Schema({ collection: "pp_events" })
export class Event extends Entity {
  @Prop(() => String, { required: true })
  label!: string;
}

/** An `Event` discriminator with a reference to a person. */
@Discriminator("signup")
export class Signup extends Event {
  declare readonly __t: DiscriminatorValue<"signup">;
  @Prop(() => Types.ObjectId, { ref: () => Person, required: true })
  user!: Ref<Person>;
}

/** An `Event` discriminator with a reference to a product. */
@Discriminator("purchase")
export class Purchase extends Event {
  declare readonly __t: DiscriminatorValue<"purchase">;
  @Prop(() => Types.ObjectId, { ref: () => Product, required: true })
  product!: Ref<Product>;
}

/** The base of the embedded `Circle` / `Square` discriminators (key `kind`). */
@Schema({ discriminatorKey: "kind" })
export class Shape {
  @Prop(() => String, { required: true })
  kind!: string;
}

/** A `Shape` discriminator with a radius and an owner reference. */
@Discriminator("circle")
export class Circle extends Shape {
  declare readonly kind: DiscriminatorValue<"circle">;
  @Prop(() => Number, { required: true })
  radius!: number;

  @Prop(() => Types.ObjectId, { ref: () => Person })
  owner?: Ref<Person>;
}

/** A `Shape` discriminator with a side length. */
@Discriminator("square")
export class Square extends Shape {
  declare readonly kind: DiscriminatorValue<"square">;
  @Prop(() => Number, { required: true })
  side!: number;
}

/** A canvas holding an array of embedded discriminated shapes. */
@Schema({ collection: "pp_canvases" })
export class Canvas extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => [Shape])
  shapes!: (Circle | Square)[];
}

/** A reading keyed by a UUID serial: the target of a virtual over UUID arrays. */
@Schema({ collection: "pp_readings" })
export class Reading extends Entity {
  @Prop(() => Types.UUID, { required: true })
  serial!: UUID;

  @Prop(() => Number, { required: true })
  value!: number;
}

/** A device that holds UUID serials and a `readings` virtual matching them. */
@Schema({ collection: "pp_devices" })
export class Device extends Entity {
  @Prop(() => [Types.UUID])
  serials!: UUID[];

  @Virtual({ ref: () => Reading, localField: "serials", foreignField: "serial" })
  readings?: VirtualRef<Reading>;
}
