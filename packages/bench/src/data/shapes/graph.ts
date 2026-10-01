import { Entity, Prop, type Ref, Schema, Types } from "@venloc/typemo";
import type { Document } from "mongodb";
import { Ids } from "../rng.ts";
import { ShapeDef } from "./shape-def.ts";

/*
 * Shape 11: the reference graph User ↔ Post ↔ Comment. Counts per size: posts = N, users = N / 10,
 * comments = N (one per post on average). Ids are deterministic, so refs are known without reading.
 */

/** A user; may pin a post. */
@Schema({ collection: "bench_graph_users" })
export class GraphUser extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { required: true, unique: true }) email!: string;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => Types.ObjectId, { ref: () => GraphPost, nullable: true }) pinnedPost!: Ref<GraphPost> | null;
}

/** A post; references its author. */
@Schema({ collection: "bench_graph_posts" })
export class GraphPost extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String) body?: string;
  @Prop(() => Types.ObjectId, { ref: () => GraphUser, required: true, index: true }) author!: Ref<GraphUser>;
  @Prop(() => Number, { min: 0 }) likes?: number;
}

/** A comment; references its post and author. */
@Schema({ collection: "bench_graph_comments" })
export class GraphComment extends Entity {
  @Prop(() => Types.ObjectId, { ref: () => GraphPost, required: true, index: true }) post!: Ref<GraphPost>;
  @Prop(() => Types.ObjectId, { ref: () => GraphUser, required: true }) author!: Ref<GraphUser>;
  @Prop(() => String, { required: true }) text!: string;
}

/** Id namespace of users. */
const USER_NS = 0x6a0f000b;
/** Id namespace of posts. */
const POST_NS = 0x6a0f000c;
/** Id namespace of comments. */
const COMMENT_NS = 0x6a0f000d;

/** Size relations of the graph. */
export class GraphSizes {
  /**
   * The number of users for a number of posts.
   *
   * @param posts - The number of posts.
   * @returns A tenth of the posts, at least 10.
   */
  static users(posts: number): number {
    return Math.max(10, Math.floor(posts / 10));
  }
}

/** The user collection of the graph. */
export const GRAPH_USER = new ShapeDef<GraphUser>({
  name: "graph-user",
  namespace: USER_NS,
  collection: "bench_graph_users",
  entity: GraphUser,
  mongooseName: "BenchGraphUser",
  mongooseSchema: (m) =>
    new m.Schema(
      {
        name: { type: String, required: true },
        email: { type: String, required: true, unique: true },
        tags: [String],
        pinnedPost: { type: m.Schema.Types.ObjectId, ref: "BenchGraphPost", default: null },
      },
      { versionKey: false },
    ),
  indexes: [{ keys: { email: 1 }, options: { unique: true } }],
  generate: (i, rng): Document => ({
    name: `${rng.word()} ${rng.word()}`,
    email: `g${i}@bench.test`,
    tags: [rng.word(), rng.word()],
    pinnedPost: i % 3 === 0 ? Ids.of(POST_NS, i) : null,
  }),
  counts: { T: 10, S: 100, M: 10_000, L: 100_000, XL: 500_000 },
});

/** The post collection of the graph. */
export const GRAPH_POST = new ShapeDef<GraphPost>({
  name: "graph-post",
  namespace: POST_NS,
  collection: "bench_graph_posts",
  entity: GraphPost,
  mongooseName: "BenchGraphPost",
  mongooseSchema: (m) =>
    new m.Schema(
      {
        title: { type: String, required: true },
        body: String,
        author: { type: m.Schema.Types.ObjectId, ref: "BenchGraphUser", required: true, index: true },
        likes: { type: Number, min: 0 },
      },
      { versionKey: false },
    ),
  indexes: [{ keys: { author: 1 } }],
  /* The author of post i is user (i mod users(S-size)); scenarios that need a size-exact graph use GraphSizes. */
  generate: (i, rng): Document => ({
    title: rng.words(4),
    body: rng.words(30),
    author: Ids.of(USER_NS, i % 100),
    likes: rng.int(0, 1000),
  }),
});

/** The comment collection of the graph. */
export const GRAPH_COMMENT = new ShapeDef<GraphComment>({
  name: "graph-comment",
  namespace: COMMENT_NS,
  collection: "bench_graph_comments",
  entity: GraphComment,
  mongooseName: "BenchGraphComment",
  mongooseSchema: (m) =>
    new m.Schema(
      {
        post: { type: m.Schema.Types.ObjectId, ref: "BenchGraphPost", required: true, index: true },
        author: { type: m.Schema.Types.ObjectId, ref: "BenchGraphUser", required: true },
        text: { type: String, required: true },
      },
      { versionKey: false },
    ),
  indexes: [{ keys: { post: 1 } }],
  generate: (i, rng): Document => ({
    post: Ids.of(POST_NS, rng.int(0, Math.max(0, i))),
    author: Ids.of(USER_NS, i % 100),
    text: rng.words(10),
  }),
});
