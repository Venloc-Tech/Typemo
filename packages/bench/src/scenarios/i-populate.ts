/*
 * Group I — populate. Every contestant reads the same parents (sorted by _id) and resolves the same
 * references; the result is normalised by ONE function per variant to "parent | resolved values" lines and
 * hashed, so a contestant that resolved less (or differently) fails the scenario. The number of commands
 * per contestant comes from the harness commands pass: the driver is the hand-written floor (one `$in` per
 * level; one `$lookup` aggregation where a per-document limit is needed).
 *
 * Sizes (group I only, 1k/10k parents): S = 1 000 posts / 100 authors, M = 10 000 posts / 1 000
 * authors; T (smoke) = 50 posts / 5 authors. Virtual variants use authors as parents (10 posts each).
 */
import type { Model } from "@venloc/typemo";
import type { Db, Document, ObjectId } from "mongodb";
import type { BenchContext } from "../adapters/bench-context.ts";
import { type ContestantImpl, Scenario, type ScenarioEnv, ScenarioKit } from "../harness/scenario.ts";
import { CONTESTANTS, type ContestantId, type Outcome, type ProfileName, type SizeName } from "../harness/types.ts";
import { BbChecksum } from "./support-bb/bb-checksum.ts";
import { Dig } from "./support-bb/bb-dig.ts";
import {
  I_COLLECTIONS,
  IAuthor,
  IComment,
  IMongoose,
  type IMongooseModels,
  IPost,
  ISeed,
  type ISizes,
} from "./support-bb/populate-models.ts";

/**
 * Lines of one normalised result.
 *
 * @example
 * ```ts
 * const lines: Lines = ["64f0…|Ann"];
 * ```
 */
type Lines = readonly string[];

/**
 * The Typemo models of the populate scenarios.
 *
 * @example
 * ```ts
 * const models: ITypemo = { Posts, Authors, Comments };
 * ```
 */
interface ITypemo {
  /** Posts. */
  readonly Posts: Model<IPost>;
  /** Authors. */
  readonly Authors: Model<IAuthor>;
  /** Comments. */
  readonly Comments: Model<IComment>;
}

/**
 * One populate variant, written for every contestant.
 *
 * @example
 * ```ts
 * const variant: IVariant = VARIANTS[0]!;
 * ```
 */
interface IVariant {
  /** Short key, part of the scenario id. */
  readonly key: string;
  /** Description of the variant. */
  readonly title: string;
  /** Whose documents are the parents. */
  readonly parents: "posts" | "authors";
  /** Sizes in `standard` (quick always takes S of the `ref` variant only). */
  readonly standardSizes: readonly SizeName[];
  /** The hand-written driver version. */
  readonly driver: (db: Db) => Promise<Lines>;
  /** The Mongoose version. */
  readonly mongoose: (m: IMongooseModels) => Promise<Lines>;
  /** The Typemo version, hydrated or lean. */
  readonly typemo: (t: ITypemo, lean: boolean) => Promise<Lines>;
}

/** Sort by `_id`, so every contestant sees the parents in the same order. */
const byId = { _id: 1 } as const;
/** The per-document limit of the `per-document-limit` variant. */
const PER_DOC = 3;

/** Driver helpers: the hand-written populate a careful application would write. */
class IDriver {
  /**
   * Reads a collection sorted by id.
   *
   * @param db - The database.
   * @param name - The collection.
   * @param filter - The query filter.
   * @returns The documents.
   */
  static find(db: Db, name: string, filter: Document = {}): Promise<Document[]> {
    return db.collection(name).find(filter).sort(byId).toArray();
  }

  /**
   * Reads documents by id with one `$in` query.
   *
   * @param db - The database.
   * @param name - The collection.
   * @param ids - The ids; duplicates are collapsed.
   * @returns The documents by hex id.
   */
  static async byIds(db: Db, name: string, ids: Iterable<ObjectId>): Promise<Map<string, Document>> {
    const unique = new Map<string, ObjectId>();
    for (const id of ids) unique.set(id.toHexString(), id);
    const docs = await db
      .collection(name)
      .find({ _id: { $in: [...unique.values()] } })
      .toArray();
    return new Map(docs.map((doc) => [Dig.id(doc), doc]));
  }

  /**
   * Posts of the authors, grouped by author (hex).
   *
   * @param db - The database.
   * @param authors - The parents.
   * @param match - An extra filter on the posts.
   * @returns The posts by author hex id.
   */
  static async postsOf(db: Db, authors: readonly Document[], match: Document = {}): Promise<Map<string, Document[]>> {
    const posts = await db
      .collection(I_COLLECTIONS.posts)
      .find({ ...match, author: { $in: authors.map((a) => a._id as ObjectId) } })
      .toArray();
    const grouped = new Map<string, Document[]>();
    for (const post of posts) {
      const key = Dig.id(post.author);
      const list = grouped.get(key);
      if (list === undefined) grouped.set(key, [post]);
      else list.push(post);
    }
    return grouped;
  }
}

/** One normaliser per variant, shared by every contestant. */
class ILines {
  /**
   * Sorted, comma-joined titles.
   *
   * @param posts - Posts.
   * @returns The titles.
   */
  static titles(posts: readonly unknown[]): string {
    return posts
      .map((post) => Dig.str(post, "title"))
      .sort()
      .join(",");
  }

  /**
   * Lines of a single-ref result.
   *
   * @param docs - Posts with a resolved author.
   * @returns `id|author name` per post.
   */
  static ref(docs: readonly unknown[]): Lines {
    return docs.map((doc) => `${Dig.id(doc)}|${Dig.str(Dig.get(doc, "author"), "name")}`);
  }

  /**
   * Lines of a ref-array result.
   *
   * @param docs - Posts with resolved tags.
   * @returns `id|tag labels` per post.
   */
  static refArray(docs: readonly unknown[]): Lines {
    return docs.map(
      (doc) =>
        `${Dig.id(doc)}|${Dig.list(doc, "tags")
          .map((tag) => Dig.str(tag, "label"))
          .join(",")}`,
    );
  }

  /**
   * Lines of a Map-of-refs result.
   *
   * @param docs - Posts with resolved tags by topic.
   * @returns `id|topic=label` per post.
   */
  static map(docs: readonly unknown[]): Lines {
    return docs.map(
      (doc) =>
        `${Dig.id(doc)}|${Dig.entries(doc, "tagsByTopic")
          .map(([key, tag]) => `${key}=${Dig.str(tag, "label")}`)
          .join(",")}`,
    );
  }

  /**
   * A normaliser for a virtual with many results.
   *
   * @param key - The virtual's field name.
   * @returns A function that turns parents into lines.
   */
  static many(key: string) {
    return (docs: readonly unknown[]): Lines =>
      docs.map((doc) => `${Dig.id(doc)}|${ILines.titles(Dig.list(doc, key))}`);
  }

  /**
   * Lines of a virtual-count result.
   *
   * @param docs - Authors with `postCount`.
   * @returns `id|count` per author.
   */
  static count(docs: readonly unknown[]): Lines {
    return docs.map((doc) => `${Dig.id(doc)}|${Dig.num(doc, "postCount")}`);
  }

  /**
   * Lines of a `justOne` virtual result.
   *
   * @param docs - Authors with `topPost`.
   * @returns `id|title` per author.
   */
  static justOne(docs: readonly unknown[]): Lines {
    return docs.map((doc) => `${Dig.id(doc)}|${Dig.str(Dig.get(doc, "topPost"), "title")}`);
  }

  /**
   * Ordered (sort views desc): the order is part of the result.
   *
   * @param docs - Authors with a limited `posts` list.
   * @returns `id|titles` per author.
   */
  static limited(docs: readonly unknown[]): Lines {
    return docs.map(
      (doc) =>
        `${Dig.id(doc)}|${Dig.list(doc, "posts")
          .map((post) => Dig.str(post, "title"))
          .join(",")}`,
    );
  }

  /**
   * Lines of a three-level result.
   *
   * @param docs - Comments with post, author and company resolved.
   * @returns `id|title|author|company` per comment.
   */
  static nested(docs: readonly unknown[]): Lines {
    return docs.map((doc) => {
      const post = Dig.get(doc, "post");
      const author = Dig.get(post, "author");
      return `${Dig.id(doc)}|${Dig.str(post, "title")}|${Dig.str(author, "name")}|${Dig.str(Dig.get(author, "company"), "name")}`;
    });
  }
}

/** Every populate variant. */
const VARIANTS: readonly IVariant[] = [
  {
    key: "ref",
    title: "single ref (Post.author)",
    parents: "posts",
    standardSizes: ["S", "M"],
    driver: async (db) => {
      const posts = await IDriver.find(db, I_COLLECTIONS.posts);
      const authors = await IDriver.byIds(
        db,
        I_COLLECTIONS.authors,
        posts.map((p) => p.author as ObjectId),
      );
      return ILines.ref(posts.map((p) => ({ ...p, author: authors.get(Dig.id(p.author)) ?? null })));
    },
    mongoose: async (m) => ILines.ref(await m.Post.find({}).sort(byId).populate("author").exec()),
    typemo: async ({ Posts }, lean) => {
      const query = Posts.find({}).sort(byId).populate("author");
      return ILines.ref(lean ? await query.lean() : await query);
    },
  },
  {
    key: "ref-array",
    title: "ref array, 5 per parent (Post.tags)",
    parents: "posts",
    standardSizes: ["S", "M"],
    driver: async (db) => {
      const posts = await IDriver.find(db, I_COLLECTIONS.posts);
      const tags = await IDriver.byIds(
        db,
        I_COLLECTIONS.tags,
        posts.flatMap((p) => p.tags as ObjectId[]),
      );
      return ILines.refArray(
        posts.map((p) => ({ ...p, tags: (p.tags as ObjectId[]).map((id) => tags.get(id.toHexString())) })),
      );
    },
    mongoose: async (m) => ILines.refArray(await m.Post.find({}).sort(byId).populate("tags").exec()),
    typemo: async ({ Posts }, lean) => {
      const query = Posts.find({}).sort(byId).populate("tags");
      return ILines.refArray(lean ? await query.lean() : await query);
    },
  },
  {
    key: "map",
    title: "Map of refs, 3 keys (Post.tagsByTopic.$*)",
    parents: "posts",
    standardSizes: ["S"],
    driver: async (db) => {
      const posts = await IDriver.find(db, I_COLLECTIONS.posts);
      const tags = await IDriver.byIds(
        db,
        I_COLLECTIONS.tags,
        posts.flatMap((p) => Object.values(p.tagsByTopic as Record<string, ObjectId>)),
      );
      return ILines.map(
        posts.map((p) => ({
          ...p,
          tagsByTopic: Object.fromEntries(
            Object.entries(p.tagsByTopic as Record<string, ObjectId>).map(([k, id]) => [k, tags.get(id.toHexString())]),
          ),
        })),
      );
    },
    mongoose: async (m) => ILines.map(await m.Post.find({}).sort(byId).populate("tagsByTopic.$*").exec()),
    typemo: async ({ Posts }, lean) => {
      const query = Posts.find({}).sort(byId).populate("tagsByTopic.$*");
      return ILines.map(lean ? await query.lean() : await query);
    },
  },
  {
    key: "virtual",
    title: "virtual, many (Author.posts, 10 per author)",
    parents: "authors",
    standardSizes: ["S"],
    driver: async (db) => {
      const authors = await IDriver.find(db, I_COLLECTIONS.authors);
      const posts = await IDriver.postsOf(db, authors);
      return ILines.many("posts")(authors.map((a) => ({ ...a, posts: posts.get(Dig.id(a)) ?? [] })));
    },
    mongoose: async (m) => ILines.many("posts")(await m.Author.find({}).sort(byId).populate("posts").exec()),
    typemo: async ({ Authors }, lean) => {
      const query = Authors.find({}).sort(byId).populate("posts");
      return ILines.many("posts")(lean ? await query.lean() : await query);
    },
  },
  {
    key: "virtual-count",
    title: "virtual count (Author.postCount)",
    parents: "authors",
    standardSizes: ["S"],
    driver: async (db) => {
      const authors = await IDriver.find(db, I_COLLECTIONS.authors);
      const counts = await db
        .collection(I_COLLECTIONS.posts)
        .aggregate<{ _id: ObjectId; n: number }>([
          { $match: { author: { $in: authors.map((a) => a._id as ObjectId) } } },
          { $group: { _id: "$author", n: { $sum: 1 } } },
        ])
        .toArray();
      const byAuthor = new Map(counts.map((c) => [c._id.toHexString(), c.n]));
      return ILines.count(authors.map((a) => ({ ...a, postCount: byAuthor.get(Dig.id(a)) ?? 0 })));
    },
    mongoose: async (m) => ILines.count(await m.Author.find({}).sort(byId).populate("postCount").exec()),
    typemo: async ({ Authors }, lean) => {
      const query = Authors.find({}).sort(byId).populate("postCount");
      return ILines.count(lean ? await query.lean() : await query);
    },
  },
  {
    key: "virtual-match",
    title: "virtual with match (Author.hotPosts)",
    parents: "authors",
    standardSizes: ["S"],
    driver: async (db) => {
      const authors = await IDriver.find(db, I_COLLECTIONS.authors);
      const posts = await IDriver.postsOf(db, authors, { hot: true });
      return ILines.many("hotPosts")(authors.map((a) => ({ ...a, hotPosts: posts.get(Dig.id(a)) ?? [] })));
    },
    mongoose: async (m) => ILines.many("hotPosts")(await m.Author.find({}).sort(byId).populate("hotPosts").exec()),
    typemo: async ({ Authors }, lean) => {
      const query = Authors.find({}).sort(byId).populate("hotPosts");
      return ILines.many("hotPosts")(lean ? await query.lean() : await query);
    },
  },
  {
    key: "virtual-just-one",
    title: "virtual justOne with sort (Author.topPost)",
    parents: "authors",
    standardSizes: ["S"],
    driver: async (db) => {
      const authors = await IDriver.find(db, I_COLLECTIONS.authors);
      const posts = await IDriver.postsOf(db, authors);
      const top = (list: readonly Document[]): Document | null =>
        list.reduce<Document | null>((best, p) => (best === null || p.views > best.views ? p : best), null);
      return ILines.justOne(authors.map((a) => ({ ...a, topPost: top(posts.get(Dig.id(a)) ?? []) })));
    },
    mongoose: async (m) => ILines.justOne(await m.Author.find({}).sort(byId).populate("topPost").exec()),
    typemo: async ({ Authors }, lean) => {
      const query = Authors.find({}).sort(byId).populate("topPost");
      return ILines.justOne(lean ? await query.lean() : await query);
    },
  },
  {
    key: "per-document-limit",
    title: `virtual perDocumentLimit ${PER_DOC}, sort views desc (Author.posts)`,
    parents: "authors",
    standardSizes: ["S"],
    driver: async (db) => {
      const authors = await IDriver.find(db, I_COLLECTIONS.authors);
      const rows = await db
        .collection(I_COLLECTIONS.authors)
        .aggregate([
          { $match: { _id: { $in: authors.map((a) => a._id as ObjectId) } } },
          {
            $lookup: {
              from: I_COLLECTIONS.posts,
              localField: "_id",
              foreignField: "author",
              as: "posts",
              pipeline: [{ $sort: { views: -1 } }, { $limit: PER_DOC }],
            },
          },
          { $project: { posts: 1 } },
        ])
        .toArray();
      const byAuthor = new Map(rows.map((row) => [Dig.id(row), row.posts as Document[]]));
      return ILines.limited(authors.map((a) => ({ ...a, posts: byAuthor.get(Dig.id(a)) ?? [] })));
    },
    mongoose: async (m) =>
      ILines.limited(
        await m.Author.find({})
          .sort(byId)
          .populate({ path: "posts", perDocumentLimit: PER_DOC, options: { sort: { views: -1 } } })
          .exec(),
      ),
    typemo: async ({ Authors }, lean) => {
      const query = Authors.find({})
        .sort(byId)
        .populate({ path: "posts", perDocumentLimit: PER_DOC, options: { sort: { views: -1 } } });
      return ILines.limited(lean ? await query.lean() : await query);
    },
  },
  {
    key: "nested-3",
    title: "nested 3 levels (Comment.post.author.company)",
    parents: "posts",
    standardSizes: ["S"],
    driver: async (db) => {
      const comments = await IDriver.find(db, I_COLLECTIONS.comments);
      const posts = await IDriver.byIds(
        db,
        I_COLLECTIONS.posts,
        comments.map((c) => c.post as ObjectId),
      );
      const authors = await IDriver.byIds(
        db,
        I_COLLECTIONS.authors,
        [...posts.values()].map((p) => p.author as ObjectId),
      );
      const companies = await IDriver.byIds(
        db,
        I_COLLECTIONS.companies,
        [...authors.values()].map((a) => a.company as ObjectId),
      );
      return ILines.nested(
        comments.map((c) => {
          const post = posts.get(Dig.id(c.post));
          const author = authors.get(Dig.id(post?.author));
          return { ...c, post: { ...post, author: { ...author, company: companies.get(Dig.id(author?.company)) } } };
        }),
      );
    },
    mongoose: async (m) =>
      ILines.nested(
        await m.Comment.find({})
          .sort(byId)
          .populate({ path: "post", populate: { path: "author", populate: { path: "company" } } })
          .exec(),
      ),
    typemo: async ({ Comments }, lean) => {
      const query = Comments.find({}).sort(byId).populate("post.author.company");
      return ILines.nested(lean ? await query.lean() : await query);
    },
  },
];

/** Posts ("parents") per size, group I only. */
const POSTS_OF: Readonly<Record<SizeName, number>> = { T: 50, S: 1_000, M: 10_000, L: 10_000, XL: 10_000 };

/** One populate variant as a scenario. */
class PopulateScenario extends Scenario {
  readonly id: string;
  readonly group = "I" as const;
  readonly title: string;
  readonly profiles: readonly ProfileName[];
  override readonly sizes: readonly SizeName[];
  override readonly contestants: readonly ContestantId[] = CONTESTANTS;
  override readonly notes: string;

  /**
   * @param variant - The variant to run.
   */
  constructor(private readonly variant: IVariant) {
    super();
    this.id = `I.populate.${variant.key}`;
    this.title = `populate: ${variant.title}`;
    this.sizes = ["S", "M"];
    this.profiles = variant.key === "ref" ? ["quick", "standard", "full"] : ["standard", "full"];
    this.notes =
      "Group I sizes: S = 1k posts / 100 authors, M = 10k posts / 1k authors (plan: 1k/10k parents). " +
      "Driver = hand-written populate (one $in per level; perDocumentLimit via one $lookup aggregation). " +
      "Mongoose perDocumentLimit sends one query per parent document.";
  }

  /**
   * quick — S (ref only); standard — S, plus M for ref/ref-array; full — S and M.
   *
   * @param profile - The profile.
   * @returns The sizes.
   */
  override sizesFor(profile: ProfileName): readonly SizeName[] {
    if (profile === "quick") return this.profiles.includes("quick") ? ["S"] : [];
    if (profile === "standard") return this.variant.standardSizes;
    return profile === "full" ? ["S", "M"] : [];
  }

  /**
   * The seeded sizes for a dataset size.
   *
   * @param size - The dataset size.
   * @returns The counts of posts, authors and so on.
   */
  private sizesOf(size: SizeName): ISizes {
    return ISeed.sizes(POSTS_OF[size]);
  }

  /**
   * Parents per operation.
   *
   * @param size - The dataset size.
   * @returns The number of parent documents.
   */
  override unitsPerOp(size: SizeName): number {
    const sizes = this.sizesOf(size);
    return this.variant.parents === "authors" ? sizes.authors : sizes.posts;
  }

  /**
   * Seeds every contestant's database.
   *
   * @param env - The scenario environment.
   */
  override async prepare(env: ScenarioEnv): Promise<void> {
    const sizes = this.sizesOf(env.size);
    for (const contestant of this.contestants) await ISeed.seed(env.ctx.dbOf(contestant), sizes);
  }

  /**
   * Builds a contestant that runs the variant and checks the number of parents.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    const expected = this.unitsPerOp(env.size);
    const impl = (work: () => Promise<Lines>): ContestantImpl<unknown> =>
      ScenarioKit.impl<Lines>({
        run: work,
        verify: (lines): Outcome => {
          if (lines.length !== expected)
            throw new Error(`${contestant}: ${lines.length} parents, expected ${expected}`);
          return { count: lines.length, checksum: BbChecksum.of(lines) };
        },
      });
    const ctx: BenchContext = env.ctx;
    const typemo = (lean: boolean): ITypemo => {
      const handle = lean ? ctx.typemoLean : ctx.typemo;
      return { Posts: handle.model(IPost), Authors: handle.model(IAuthor), Comments: handle.model(IComment) };
    };
    return ScenarioKit.pick(
      {
        driver: () => impl(() => this.variant.driver(ctx.driver.db)),
        mongoose: () => {
          const models = IMongoose.models(ctx.mongoose);
          return impl(() => this.variant.mongoose(models));
        },
        "mongoose-safe": () => {
          const models = IMongoose.models(ctx.mongooseSafe);
          return impl(() => this.variant.mongoose(models));
        },
        typemo: () => {
          const models = typemo(false);
          return impl(() => this.variant.typemo(models, false));
        },
        "typemo-lean": () => {
          const models = typemo(true);
          return impl(() => this.variant.typemo(models, true));
        },
      },
      contestant,
    ) as ContestantImpl<unknown>;
  }
}

/** The scenarios of group I. */
export const SCENARIOS: readonly Scenario[] = VARIANTS.map((variant) => new PopulateScenario(variant));
