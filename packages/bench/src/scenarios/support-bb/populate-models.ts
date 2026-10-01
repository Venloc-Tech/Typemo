/*
 * Group I: the reference graph Company ← Author ← Post ← Comment plus Tag, the same for Typemo (classes)
 * and Mongoose (schemas), on the same collections. The data is seeded once with the raw driver
 * (deterministic), every contestant only reads it.
 */
import "reflect-metadata";
import { Entity, Prop, type Ref, Schema, Spec, Types, Virtual, type VirtualRef } from "@venloc/typemo";
import type { Db, ObjectId } from "mongodb";
import type { Model, Mongoose, Schema as MSchema } from "mongoose";
import type { MongooseHandle } from "../../adapters/bench-context.ts";

/** The collections of group I. */
export const I_COLLECTIONS = {
  companies: "bb_i_companies",
  authors: "bb_i_authors",
  tags: "bb_i_tags",
  posts: "bb_i_posts",
  comments: "bb_i_comments",
} as const;

/** The collection that records which graph is seeded. */
const I_MARKER = "bb_i_marker";

/** A company. */
@Schema({ collection: I_COLLECTIONS.companies })
export class ICompany extends Entity {
  @Prop(() => String, { required: true })
  name!: string;
}

/** A tag. */
@Schema({ collection: I_COLLECTIONS.tags })
export class ITag extends Entity {
  @Prop(() => String, { required: true })
  label!: string;
}

/** An author, with virtual populate of the posts. */
@Schema({ collection: I_COLLECTIONS.authors })
export class IAuthor extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => Types.ObjectId, { ref: () => ICompany, required: true })
  company!: Ref<ICompany>;

  @Virtual({ ref: () => IPost, localField: "_id", foreignField: "author" })
  posts?: VirtualRef<IPost>;

  @Virtual({ ref: () => IPost, localField: "_id", foreignField: "author", count: true })
  postCount?: VirtualRef<IPost, false, true>;

  @Virtual({
    ref: () => IPost,
    localField: "_id",
    foreignField: "author",
    justOne: true,
    options: { sort: { views: -1 } },
  })
  topPost?: VirtualRef<IPost, true>;

  @Virtual({ ref: () => IPost, localField: "_id", foreignField: "author", match: { hot: true } })
  hotPosts?: VirtualRef<IPost>;
}

/** A post, with a ref to its author, a ref array and a Map of refs. */
@Schema({ collection: I_COLLECTIONS.posts })
export class IPost extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number, { required: true })
  views!: number;

  @Prop(() => Boolean, { required: true })
  hot!: boolean;

  @Prop(() => Types.ObjectId, { ref: () => IAuthor, required: true })
  author!: Ref<IAuthor>;

  @Prop(() => [Types.ObjectId], { ref: () => ITag })
  tags!: Ref<ITag>[];

  @Prop(() => Spec.map(Types.ObjectId), { ref: () => ITag })
  tagsByTopic?: Map<string, Ref<ITag>>;
}

/** A comment on a post. */
@Schema({ collection: I_COLLECTIONS.comments })
export class IComment extends Entity {
  @Prop(() => String, { required: true })
  body!: string;

  @Prop(() => Types.ObjectId, { ref: () => IPost, required: true })
  post!: Ref<IPost>;
}

/**
 * A loosely typed Mongoose model.
 *
 * @example
 * ```ts
 * const Posts: MModel = models.Post;
 * ```
 */
type MModel = Model<Record<string, unknown>>;

/**
 * The Mongoose models of the graph.
 *
 * @example
 * ```ts
 * const models: IMongooseModels = IMongoose.models(handle);
 * ```
 */
export interface IMongooseModels {
  /** Companies. */
  readonly Company: MModel;
  /** Tags. */
  readonly Tag: MModel;
  /** Authors. */
  readonly Author: MModel;
  /** Posts. */
  readonly Post: MModel;
  /** Comments. */
  readonly Comment: MModel;
}

/** The Mongoose side of the graph, on the same collections. */
export class IMongoose {
  /**
   * The graph on one Mongoose handle (schemas built with the handle's own `Mongoose` instance).
   *
   * @param handle - The Mongoose contestant.
   * @returns The models.
   */
  static models(handle: MongooseHandle): IMongooseModels {
    const author = (m: Mongoose): MSchema => {
      const schema = new m.Schema({
        name: { type: String, required: true },
        company: { type: m.Schema.Types.ObjectId, ref: "BbICompany", required: true },
      });
      schema.virtual("posts", { ref: "BbIPost", localField: "_id", foreignField: "author" });
      schema.virtual("postCount", { ref: "BbIPost", localField: "_id", foreignField: "author", count: true });
      schema.virtual("topPost", {
        ref: "BbIPost",
        localField: "_id",
        foreignField: "author",
        justOne: true,
        options: { sort: { views: -1 } },
      });
      schema.virtual("hotPosts", { ref: "BbIPost", localField: "_id", foreignField: "author", match: { hot: true } });
      return schema;
    };
    const post = (m: Mongoose): MSchema =>
      new m.Schema({
        title: { type: String, required: true },
        views: { type: Number, required: true },
        hot: { type: Boolean, required: true },
        author: { type: m.Schema.Types.ObjectId, ref: "BbIAuthor", required: true },
        tags: [{ type: m.Schema.Types.ObjectId, ref: "BbITag" }],
        tagsByTopic: { type: Map, of: { type: m.Schema.Types.ObjectId, ref: "BbITag" } },
      });
    return {
      Company: handle.model(
        "BbICompany",
        I_COLLECTIONS.companies,
        (m) => new m.Schema({ name: { type: String, required: true } }),
      ),
      Tag: handle.model("BbITag", I_COLLECTIONS.tags, (m) => new m.Schema({ label: { type: String, required: true } })),
      Author: handle.model("BbIAuthor", I_COLLECTIONS.authors, author),
      Post: handle.model("BbIPost", I_COLLECTIONS.posts, post),
      Comment: handle.model(
        "BbIComment",
        I_COLLECTIONS.comments,
        (m) =>
          new m.Schema({
            body: { type: String, required: true },
            post: { type: m.Schema.Types.ObjectId, ref: "BbIPost", required: true },
          }),
      ),
    };
  }
}

/**
 * How many documents each collection of the graph gets.
 *
 * @example
 * ```ts
 * const sizes: ISizes = ISeed.sizes(1_000);
 * ```
 */
export interface ISizes {
  /** Posts and comments: the "parents" of the reference scenarios. */
  readonly posts: number;
  /** Authors: the parents of the virtual scenarios (10 posts each). */
  readonly authors: number;
  /** Companies. */
  readonly companies: number;
  /** Tags. */
  readonly tags: number;
}

/** Deterministic seed with the raw driver: ids are generated from the index, so every run is the same. */
export class ISeed {
  /**
   * The collection sizes for a number of posts.
   *
   * @param posts - The number of posts.
   * @returns The sizes of every collection.
   */
  static sizes(posts: number): ISizes {
    return {
      posts,
      authors: Math.max(1, Math.floor(posts / 10)),
      companies: 50,
      tags: 200,
    };
  }

  /**
   * A deterministic ObjectId: a 4-byte collection code plus the index.
   *
   * @param code - The collection code.
   * @param index - The document index.
   * @returns The id.
   */
  static oid(code: number, index: number): ObjectId {
    return new Types.ObjectId(`${code.toString(16).padStart(8, "0")}${index.toString(16).padStart(16, "0")}`);
  }

  /**
   * Seeds `db` unless it already holds exactly this graph (marker document).
   *
   * @param db - The database.
   * @param sizes - The collection sizes.
   */
  static async seed(db: Db, sizes: ISizes): Promise<void> {
    const marker = db.collection<{ _id: string; posts: number }>(I_MARKER);
    if ((await marker.findOne({ _id: "graph" }))?.posts === sizes.posts) return;
    const o = ISeed.oid;
    await marker.deleteMany({});
    await Promise.all(Object.values(I_COLLECTIONS).map((name) => db.collection(name).deleteMany({})));
    const insert = async (name: string, docs: readonly object[]): Promise<void> => {
      for (let i = 0; i < docs.length; i += 5000)
        await db.collection(name).insertMany(docs.slice(i, i + 5000).map((doc) => ({ ...doc })));
    };
    await insert(
      I_COLLECTIONS.companies,
      Array.from({ length: sizes.companies }, (_, i) => ({ _id: o(1, i), name: `company-${i}` })),
    );
    await insert(
      I_COLLECTIONS.tags,
      Array.from({ length: sizes.tags }, (_, i) => ({ _id: o(2, i), label: `tag-${i}` })),
    );
    await insert(
      I_COLLECTIONS.authors,
      Array.from({ length: sizes.authors }, (_, i) => ({
        _id: o(3, i),
        name: `author-${i}`,
        company: o(1, i % sizes.companies),
      })),
    );
    await insert(
      I_COLLECTIONS.posts,
      Array.from({ length: sizes.posts }, (_, i) => ({
        _id: o(4, i),
        title: `post-${i}`,
        views: (i * 7919) % sizes.posts,
        hot: i % 3 === 0,
        author: o(3, i % sizes.authors),
        tags: Array.from({ length: 5 }, (_, k) => o(2, (i + k * 17) % sizes.tags)),
        tagsByTopic: { a: o(2, i % sizes.tags), b: o(2, (i + 1) % sizes.tags), c: o(2, (i + 2) % sizes.tags) },
      })),
    );
    await insert(
      I_COLLECTIONS.comments,
      Array.from({ length: sizes.posts }, (_, i) => ({ _id: o(5, i), body: `comment-${i}`, post: o(4, i) })),
    );
    await db.collection(I_COLLECTIONS.posts).createIndex({ author: 1 });
    await marker.insertOne({ _id: "graph", posts: sizes.posts });
  }
}
