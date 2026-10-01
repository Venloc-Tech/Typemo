/*
 * The schemas of mongoose test/model.populate.test.js and test/document.populate.test.js as Typemo classes.
 * Mongoose's `ref: 'Name'` becomes `ref: () => Class`; a schema that only exists inside one
 * test is a class here, named after the test. Collections are prefixed `pmp_`.
 */
import type { ObjectId, UUID } from "mongodb";
import {
  type Defaulted,
  Discriminator,
  type DiscriminatorValue,
  Entity,
  Prop,
  type Ref,
  Schema,
  Spec,
  Types,
  Virtual,
  type VirtualRef,
} from "../../../src/index.ts";

/* the shared schemas of model.populate.test.js:28-60 */

/** The shared user: blog post and follower references, defaulted gender and age. */
@Schema({ collection: "pmp_users" })
export class MUser extends Entity {
  @Prop(() => String)
  name?: string;

  @Prop(() => String)
  email?: string;

  @Prop(() => String, { enum: ["male", "female"], default: "male" })
  gender!: Defaulted<"male" | "female">;

  @Prop(() => Number, { default: 21 })
  age!: Defaulted<number>;

  @Prop(() => [Types.ObjectId], { ref: () => MBlogPost })
  blogposts!: Ref<MBlogPost>[];

  @Prop(() => [Types.ObjectId], { ref: () => MUser })
  followers!: Ref<MUser>[];
}

/** The shared comment: a creator and an array of user references, embedded in blog posts. */
@Schema()
export class MComment extends Entity {
  @Prop(() => [Types.ObjectId], { ref: () => MUser })
  asers!: Ref<MUser>[];

  @Prop(() => Types.ObjectId, { ref: () => MUser })
  _creator?: Ref<MUser>;

  @Prop(() => String)
  content?: string;
}

/** The shared blog post: a nullable creator, embedded comments and fans. */
@Schema({ collection: "pmp_blogposts" })
export class MBlogPost extends Entity {
  @Prop(() => Types.ObjectId, { ref: () => MUser, nullable: true })
  _creator?: Ref<MUser> | null;

  @Prop(() => String)
  title?: string;

  @Prop(() => [MComment])
  comments!: MComment[];

  @Prop(() => [Types.ObjectId], { ref: () => MUser })
  fans!: Ref<MUser>[];
}

/* single tests */

/** gh-2151: users with friends, posts by author. */
@Schema({ collection: "pmp_friends" })
export class FriendUser extends Entity {
  @Prop(() => String)
  name?: string;

  @Prop(() => [Types.ObjectId], { ref: () => FriendUser })
  friends!: Ref<FriendUser>[];
}

/** A post by a `FriendUser` (gh-2151). */
@Schema({ collection: "pmp_friend_posts" })
export class FriendPost extends Entity {
  @Prop(() => String)
  title?: string;

  @Prop(() => [String])
  tags!: string[];

  @Prop(() => Types.ObjectId, { ref: () => FriendUser })
  author?: Ref<FriendUser>;
}

/** gh-1490: limit per document. */
@Schema({ collection: "pmp_things" })
export class Thing extends Entity {
  @Prop(() => String)
  name?: string;
}

/** A list of `Thing` references (gh-1490: limit per document). */
@Schema({ collection: "pmp_thing_lists" })
export class ThingList extends Entity {
  @Prop(() => [Types.ObjectId], { ref: () => Thing })
  b!: Ref<Thing>[];
}

/** String and Number _ids. */
@Schema({ collection: "pmp_string_users" })
export class StringUser {
  @Prop(() => String, { required: true })
  _id!: string;

  @Prop(() => String)
  name?: string;
}

/** A note that refers to string-keyed users. */
@Schema({ collection: "pmp_string_notes" })
export class StringNote extends Entity {
  @Prop(() => String, { ref: () => StringUser })
  author?: Ref<StringUser, string>;

  @Prop(() => String)
  body?: string;
}

/** A user with a Number `_id`. */
@Schema({ collection: "pmp_number_users" })
export class NumberUser {
  @Prop(() => Number, { required: true })
  _id!: number;

  @Prop(() => String)
  name?: string;
}

/** A note that refers to Number-keyed users. */
@Schema({ collection: "pmp_number_notes" })
export class NumberNote extends Entity {
  @Prop(() => Number, { ref: () => NumberUser })
  author?: Ref<NumberUser, number>;

  @Prop(() => String)
  body?: string;
}

/** DynRef (refPath), Number _ids. The name path is relative to the (sub)document holding the reference. */
@Schema({ collection: "pmp_items1" })
export class Item1 {
  @Prop(() => Number, { required: true })
  _id!: number;

  @Prop(() => String)
  name?: string;
}

/** The second `refPath` target (Number `_id`, an `otherName`). */
@Schema({ collection: "pmp_items2" })
export class Item2 {
  @Prop(() => Number, { required: true })
  _id!: number;

  @Prop(() => String)
  otherName?: string;
}

/** A nested object holding a `refPath` reference. */
@Schema({ nested: true })
export class ItemRef {
  @Prop(() => Number, { refPath: "type" })
  id?: Ref<Item1 | Item2, number>;

  @Prop(() => String)
  type?: string;
}

/** An array element holding a `refPath` reference. */
@Schema()
export class ItemRefElement {
  @Prop(() => Number, { refPath: "type" })
  id?: Ref<Item1 | Item2, number>;

  @Prop(() => String)
  type?: string;
}

/** A review with a `refPath` reference in a nested object and in an array. */
@Schema({ collection: "pmp_reviews" })
export class Review {
  @Prop(() => Number, { required: true })
  _id!: number;

  @Prop(() => String)
  text?: string;

  @Prop(() => ItemRef)
  item?: ItemRef;

  @Prop(() => [ItemRefElement])
  items!: ItemRefElement[];
}

/** An offer whose `refPath` is the `city` field. */
@Schema({ collection: "pmp_offers" })
export class Offer extends Entity {
  @Prop(() => String)
  text?: string;

  @Prop(() => String)
  city?: string;

  @Prop(() => Types.ObjectId, { refPath: "city" })
  formData?: Ref<Item1 | Item2>;
}

/** gh-1444 */
@Schema({ collection: "pmp_media" })
export class Media extends Entity {
  @Prop(() => String)
  filename?: string;
}

/** An article that refers to a `Media` document (gh-1444). */
@Schema({ collection: "pmp_articles" })
export class MediaArticle extends Entity {
  @Prop(() => String)
  body?: string;

  @Prop(() => Types.ObjectId, { ref: () => Media })
  mediaAttach?: Ref<Media>;

  @Prop(() => String)
  author?: string;
}

/** handles skip */
@Schema({ collection: "pmp_movies" })
export class Movie extends Entity {}

/** A category that refers to movies. */
@Schema({ collection: "pmp_categories" })
export class Category extends Entity {
  @Prop(() => [Types.ObjectId], { ref: () => Movie })
  movies!: Ref<Movie>[];
}

/** gh-3904 */
@Schema({ collection: "pmp_players" })
export class Player extends Entity {
  @Prop(() => String)
  name?: string;
}

/** A team whose members are players. */
@Schema({ collection: "pmp_teams" })
export class Team extends Entity {
  @Prop(() => String)
  name?: string;

  @Prop(() => [Types.ObjectId], { ref: () => Player })
  members!: Ref<Player>[];
}

/** A game between two teams. */
@Schema({ collection: "pmp_games" })
export class Game extends Entity {
  @Prop(() => Types.ObjectId, { ref: () => Team })
  team?: Ref<Team>;

  @Prop(() => Types.ObjectId, { ref: () => Team })
  opponent?: Ref<Team>;
}

/** gh-3973: four levels. */
@Schema({ collection: "pmp_level4" })
export class Level4 extends Entity {
  @Prop(() => String)
  name?: string;
}

/** The third level: refers to level 4. */
@Schema({ collection: "pmp_level3" })
export class Level3 extends Entity {
  @Prop(() => String)
  name?: string;

  @Prop(() => [Types.ObjectId], { ref: () => Level4 })
  level4!: Ref<Level4>[];
}

/** The second level: refers to level 3. */
@Schema({ collection: "pmp_level2" })
export class Level2 extends Entity {
  @Prop(() => String)
  name?: string;

  @Prop(() => [Types.ObjectId], { ref: () => Level3 })
  level3!: Ref<Level3>[];
}

/** The first level: refers to level 2. */
@Schema({ collection: "pmp_level1" })
export class Level1 extends Entity {
  @Prop(() => String)
  name?: string;

  @Prop(() => [Types.ObjectId], { ref: () => Level2 })
  level2!: Ref<Level2>[];
}

/** Populate virtuals (gh-2562): people and bands. */
@Schema({ collection: "pmp_musicians" })
export class Musician extends Entity {
  @Prop(() => String)
  name?: string;

  @Prop(() => String)
  band?: string;
}

/** A band with populate virtuals over its musicians (many, justOne, with a match, over an array). */
@Schema({ collection: "pmp_bands" })
export class Band extends Entity {
  @Prop(() => String)
  name?: string;

  @Prop(() => [String])
  people!: string[];

  @Virtual({ ref: () => Musician, localField: "name", foreignField: "band" })
  members?: VirtualRef<Musician>;

  @Virtual({ ref: () => Musician, localField: "name", foreignField: "band", justOne: true })
  member?: VirtualRef<Musician, true>;

  @Virtual({
    ref: () => Musician,
    localField: "name",
    foreignField: "band",
    match: { name: { $regex: "^a", $options: "i" } },
  })
  aMembers?: VirtualRef<Musician>;

  @Virtual({ ref: () => Musician, localField: "people", foreignField: "name" })
  listed?: VirtualRef<Musician>;
}

/** justOne (gh-4263, gh-4284): Number _id posts, people with authored ids. */
@Schema({ collection: "pmp_authors" })
export class Author extends Entity {
  @Prop(() => String)
  name?: string;

  @Prop(() => [Number])
  authored!: number[];
}

/** A post with a Number `_id` and a justOne `author` virtual. */
@Schema({ collection: "pmp_number_posts" })
export class NumberPost {
  @Prop(() => Number, { required: true })
  _id!: number;

  @Prop(() => String)
  title?: string;

  @Virtual({ ref: () => Author, localField: "_id", foreignField: "authored", justOne: true })
  author?: VirtualRef<Author, true>;
}

/** gh-7397: match functions. */
@Schema({ collection: "pmp_as" })
export class TimedA extends Entity {
  @Prop(() => String)
  name?: string;

  @Prop(() => Date)
  createdAt?: Date;
}

/** The target of `TimedA`'s match-function populate. */
@Schema({ collection: "pmp_bs" })
export class TimedB extends Entity {
  @Prop(() => [Types.ObjectId], { ref: () => TimedA })
  as!: Ref<TimedA>[];

  @Prop(() => Date)
  minDate?: Date;
}

/** count (gh-4469, gh-8475), perDocumentLimit (gh-7318), skip/limit (gh-8445). */
@Schema({ collection: "pmp_children" })
export class Child {
  @Prop(() => Number, { required: true })
  _id!: number;

  @Prop(() => Types.ObjectId)
  parentId?: ObjectId;

  @Prop(() => Boolean)
  deleted?: boolean;
}

/** A parent with count, sorted, per-document-limited and skip/limit virtuals over its children. */
@Schema({ collection: "pmp_parents" })
export class Parent extends Entity {
  @Prop(() => String)
  name?: string;

  @Virtual({ ref: () => Child, localField: "_id", foreignField: "parentId", count: true })
  childCount?: VirtualRef<Child, false, true>;

  @Virtual({
    ref: () => Child,
    localField: "_id",
    foreignField: "parentId",
    count: true,
    match: { deleted: { $ne: true } },
  })
  liveChildCount?: VirtualRef<Child, false, true>;

  @Virtual({ ref: () => Child, localField: "_id", foreignField: "parentId", options: { sort: { _id: 1 } } })
  children?: VirtualRef<Child>;

  @Virtual({
    ref: () => Child,
    localField: "_id",
    foreignField: "parentId",
    options: { sort: { _id: 1 } },
    perDocumentLimit: 2,
  })
  firstTwo?: VirtualRef<Child>;

  @Virtual({
    ref: () => Child,
    localField: "_id",
    foreignField: "parentId",
    options: { sort: { _id: 1 }, skip: 1, limit: 2 },
  })
  window?: VirtualRef<Child>;
}

/** gh-8657: number refs. */
@Schema({ collection: "pmp_number_people" })
export class NumberPerson {
  @Prop(() => Number, { required: true })
  _id!: number;
}

/** An article that refers to Number-keyed people. */
@Schema({ collection: "pmp_number_articles" })
export class NumberArticle extends Entity {
  @Prop(() => [Number], { ref: () => NumberPerson })
  authors!: Ref<NumberPerson, number>[];
}

/** transform (gh-3375, gh-10064). */
@Schema({ collection: "pmp_kids" })
export class Kid extends Entity {
  @Prop(() => String)
  name?: string;

  @Prop(() => Types.ObjectId)
  parentId?: ObjectId;
}

/** A family with kid references and virtuals (transform tests). */
@Schema({ collection: "pmp_family" })
export class Family extends Entity {
  @Prop(() => String)
  name?: string;

  @Prop(() => [Types.ObjectId], { ref: () => Kid })
  children!: Ref<Kid>[];

  @Prop(() => Types.ObjectId, { ref: () => Kid })
  child?: Ref<Kid>;

  @Virtual({ ref: () => Kid, localField: "_id", foreignField: "parentId", justOne: true })
  firstKid?: VirtualRef<Kid, true>;

  @Virtual({ ref: () => Kid, localField: "_id", foreignField: "parentId" })
  kids?: VirtualRef<Kid>;
}

/** gh-12834: match on _id. */
@Schema({ collection: "pmp_stories" })
export class Story extends Entity {
  @Prop(() => String)
  title?: string;
}

/** A writer that refers to stories (gh-12834). */
@Schema({ collection: "pmp_writers" })
export class Writer extends Entity {
  @Prop(() => String)
  name?: string;

  @Prop(() => [Types.ObjectId], { ref: () => Story })
  stories!: Ref<Story>[];
}

/** gh-14869: UUID _ids. */
@Schema({ collection: "pmp_nodes" })
export class UuidNode {
  @Prop(() => Types.UUID, { required: true })
  _id!: UUID;

  @Prop(() => String)
  name?: string;
}

/** A root with a UUID `_id` and an array of UUID node references. */
@Schema({ collection: "pmp_roots" })
export class UuidRoot {
  @Prop(() => Types.UUID, { required: true })
  _id!: UUID;

  @Prop(() => String)
  status?: string;

  @Prop(() => [Types.UUID], { ref: () => UuidNode })
  node!: Ref<UuidNode, UUID>[];
}

/** gh-9359: refPath underneath a Map of subdocuments. */
@Schema({ collection: "pmp_map_users" })
export class MapUser extends Entity {
  @Prop(() => String)
  name?: string;
}

/** The value of a Map of subdocuments; its reference is picked by the `refp` field. */
@Schema()
export class RowValue {
  @Prop(() => Types.ObjectId, { refPath: "refp" })
  valueObject?: Ref<MapUser>;

  @Prop(() => String)
  refp?: string;
}

/** A row holding a Map of `RowValue` subdocuments. */
@Schema({ collection: "pmp_rows" })
export class Row extends Entity {
  @Prop(() => Number, { required: true })
  sortOrder!: number;

  @Prop(() => Spec.map(RowValue))
  values?: Map<string, RowValue>;
}

/** gh-3878: discriminator child schemas. */
@Schema({ collection: "pmp_activities", discriminatorKey: "kind" })
export class MActivity extends Entity {
  @Prop(() => String)
  kind?: string;

  @Prop(() => String)
  title?: string;
}

/** An `MActivity` discriminator with a required `postedBy` reference. */
@Discriminator("Date")
export class DateActivity extends MActivity {
  declare readonly kind: DiscriminatorValue<"Date">;
  @Prop(() => Types.ObjectId, { ref: () => MapUser, required: true })
  postedBy!: Ref<MapUser>;
}

/** An `MActivity` discriminator with a plain `test` field. */
@Discriminator("Event")
export class EventActivity extends MActivity {
  declare readonly kind: DiscriminatorValue<"Event">;
  @Prop(() => String)
  test?: string;
}

/** document.populate.test.js: bands with members and a lead. */
@Schema({ collection: "pmp_band_people" })
export class BandPerson extends Entity {
  @Prop(() => String)
  name?: string;
}

/** A band with member references and a lead. */
@Schema({ collection: "pmp_bands_with_members" })
export class MemberBand extends Entity {
  @Prop(() => String)
  name?: string;

  @Prop(() => [Types.ObjectId], { ref: () => BandPerson })
  members!: Ref<BandPerson>[];

  @Prop(() => Types.ObjectId, { ref: () => BandPerson })
  lead?: Ref<BandPerson>;
}
