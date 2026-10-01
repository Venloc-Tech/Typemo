/*
 * Mongoose middleware tests ported to the hook runtime of Typemo. The logic of each test
 * is kept; the syntax is Typemo's: events name their scope (`query.find`, `document.save`, …), post-error
 * hooks are `@PostError` (no `(error, res, next)` arity), `skip(result)` replaces `skipMiddlewareFunction`.
 * Divergences are marked in the test and in test/ported/INDEX.md.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import {
  Entity,
  Filters,
  type HydratedDoc,
  type Model,
  type OperationHookContext,
  Post,
  PostError,
  Pre,
  Prop,
  type Ref,
  Schema,
  Types,
  VersionError,
  Versioned,
} from "../../../src/internal.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("ported_middleware");

/** Counters the hooks of this file write (reset per test). */
class C {
  static n: Record<string, number> = {};
  static seen: unknown[] = [];
  static bump(key: string): void {
    C.n[key] = (C.n[key] ?? 0) + 1;
  }
}

beforeEach(() => {
  C.n = {};
  C.seen = [];
});

@Schema({ collection: "pm_publishers" })
class Publisher extends Entity {
  @Prop(() => String) name?: string;
}

@Schema({ collection: "pm_authors" })
class Author extends Entity {
  @Prop(() => String) title?: string;
  @Prop(() => String) author?: string;
  @Prop(() => String) options?: string;

  @Pre("query.find") preFind(this: OperationHookContext<Author>): void {
    C.bump("pre find");
  }
  @Post("query.find") postFind(this: OperationHookContext<Author>, results: readonly unknown[]): void {
    C.bump("post find");
    C.seen.push(results);
  }
  @Pre("query.findOne") preFindOne(this: OperationHookContext<Author>): void {
    C.bump("pre findOne");
  }
  @Post("query.findOne") postFindOne(this: OperationHookContext<Author>, result: unknown): void {
    C.bump("post findOne");
    C.seen.push(result);
  }
  @Pre([
    "query.countDocuments",
    "query.estimatedDocumentCount",
    "query.updateOne",
    "query.updateMany",
    "query.deleteOne",
    "query.deleteMany",
    "query.distinct",
  ])
  preOther(this: OperationHookContext<Author>): void {
    C.bump(`pre ${this.event}`);
  }
  @Post([
    "query.countDocuments",
    "query.estimatedDocumentCount",
    "query.updateOne",
    "query.updateMany",
    "query.deleteOne",
    "query.deleteMany",
    "query.distinct",
  ])
  postOther(this: OperationHookContext<Author>, result: unknown): void {
    C.bump(`post ${this.event}`);
    C.seen.push(result);
  }
}

let Authors: Model<Author>;

const initializeData = async (): Promise<void> => {
  Authors = t.connection.model(Author);
  const publisher = await t.connection.model(Publisher).create({ name: "Wiley" });
  await Authors.create({ title: "Professional AngularJS", author: "Val", options: "bacon" });
  void publisher;
  C.n = {};
  C.seen = [];
};

describe("query middleware (ported from test/query.middleware.test.js)", () => {
  // ported from mongoose test/query.middleware.test.js:59 "has a pre find hook"
  test("has a pre find hook", async () => {
    await initializeData();
    await Authors.find({ title: "x" });
    expect(C.n["pre find"]).toBe(1);
  });

  // ported from mongoose test/query.middleware.test.js:70 "has post find hooks"
  test("has post find hooks", async () => {
    await initializeData();
    const docs = await Authors.find({ title: "Professional AngularJS" });
    expect(C.n["post find"]).toBe(1);
    const results = C.seen[0] as readonly Author[];
    expect(results.length).toBe(1);
    expect(results[0]?.author).toBe("Val");
    expect(results[0]?.options).toBe("bacon");
    expect(docs.length).toBe(1);
  });

  // ported from mongoose test/query.middleware.test.js:109 "has separate pre-findOne() and post-findOne() hooks"
  test("has separate pre-findOne() and post-findOne() hooks", async () => {
    await initializeData();
    const doc = await Authors.findOne({ title: "Professional AngularJS" });
    expect(C.n["pre findOne"]).toBe(1);
    expect(C.n["post findOne"]).toBe(1);
    expect((C.seen[0] as Author).author).toBe("Val");
    expect(doc?.author).toBe("Val");
    expect(C.n["pre find"]).toBeUndefined();
  });

  // ported from mongoose test/query.middleware.test.js:185 "has hooks for countDocuments()"
  test("has hooks for countDocuments()", async () => {
    await initializeData();
    const count = await Authors.countDocuments({ title: "Professional AngularJS" });
    expect(count).toBe(1);
    expect(C.n["pre query.countDocuments"]).toBe(1);
    expect(C.n["post query.countDocuments"]).toBe(1);
  });

  // ported from mongoose test/query.middleware.test.js:208 "has hooks for estimatedDocumentCount()"
  test("has hooks for estimatedDocumentCount()", async () => {
    await initializeData();
    expect(await Authors.estimatedDocumentCount()).toBe(1);
    expect(C.n["pre query.estimatedDocumentCount"]).toBe(1);
    expect(C.n["post query.estimatedDocumentCount"]).toBe(1);
  });

  // ported from mongoose test/query.middleware.test.js:231 "updateOne() (gh-3997)" — `{}` → Filters.all()
  test("updateOne() (gh-3997)", async () => {
    await initializeData();
    await Authors.updateOne(Filters.all<Author>(), { $set: { author: "updatedOne" } });
    expect(C.n["pre query.updateOne"]).toBe(1);
    expect(C.n["post query.updateOne"]).toBe(1);
    expect((await Authors.find({ author: "updatedOne" })).length).toBe(1);
  });

  // ported from mongoose test/query.middleware.test.js:256 "updateMany() (gh-3997)"
  test("updateMany() (gh-3997)", async () => {
    await initializeData();
    await Authors.create({ author: "test" });
    await Authors.updateMany(Filters.all<Author>(), { $set: { author: "updatedMany" } });
    expect(C.n["pre query.updateMany"]).toBe(1);
    expect(C.n["post query.updateMany"]).toBe(1);
    const res = await Authors.find();
    expect(res.length).toBeGreaterThan(1);
    expect(res.every((doc) => doc.author === "updatedMany")).toBe(true);
  });

  // ported from mongoose test/query.middleware.test.js:282 "deleteOne() (gh-7195)"
  test("deleteOne() (gh-7195)", async () => {
    await initializeData();
    await Authors.create([{ title: "foo" }, { title: "bar" }]);
    const res = await Authors.deleteOne({ title: "foo" });
    expect(res.deletedCount).toBe(1);
    expect(C.n["pre query.deleteOne"]).toBe(1);
    expect(C.n["post query.deleteOne"]).toBe(1);
  });

  // ported from mongoose test/query.middleware.test.js:308 "deleteMany() (gh-7195)"
  test("deleteMany() (gh-7195)", async () => {
    await initializeData();
    await Authors.deleteMany(Filters.all<Author>());
    expect(C.n["pre query.deleteMany"]).toBe(1);
    expect(C.n["post query.deleteMany"]).toBe(1);
    expect(await Authors.countDocuments()).toBe(0);
  });

  // ported from mongoose test/query.middleware.test.js:333 "distinct (gh-5938)"
  test("distinct (gh-5938)", async () => {
    await initializeData();
    await Authors.create([{ title: "foo" }, { title: "bar" }, { title: "bar" }]);
    const res = await Authors.distinct("title");
    expect([...res].sort()).toEqual(["Professional AngularJS", "bar", "foo"]);
    expect(C.n["pre query.distinct"]).toBe(1);
    expect(C.n["post query.distinct"]).toBe(1);
  });

  // ported from mongoose test/query.middleware.test.js:174 "can populate in post hook"
  test("can populate in post hook", async () => {
    @Schema({ collection: "pm_books" })
    class Book extends Entity {
      @Prop(() => String) author?: string;
      @Prop(() => Types.ObjectId, { ref: () => Publisher }) publisher?: Ref<Publisher>;
      @Post("query.findOne") async populate(this: OperationHookContext<Book>, doc: unknown): Promise<void> {
        await (doc as HydratedDoc<Book>).$populate("publisher");
      }
    }
    const publisher = await t.connection.model(Publisher).create({ name: "Wiley" });
    const Books = t.connection.model(Book);
    await Books.create({ author: "Val", publisher: publisher._id });
    const doc = await Books.findOne({ author: "Val" });
    expect(doc?.author).toBe("Val");
    // Populated by a hook — `$assertPopulated` checks it and types the path
    expect(doc?.$assertPopulated("publisher").publisher?.name).toBe("Wiley");
  });
});

// ---- error handlers ------------------------------------------------------------------------------------

@Schema({ collection: "pm_titled" })
class Titled extends Entity {
  @Prop(() => String, { unique: true, sparse: true }) title?: string;

  @PostError("query.updateOne") translate(this: OperationHookContext<Titled>, error: unknown): never {
    C.seen.push(error);
    throw new Error("woops");
  }
}

@Schema({ collection: "pm_required" })
class RequiredTitle extends Entity {
  @Prop(() => String, { required: true }) title!: string;

  @PostError("document.validate") validateError(): void {
    C.bump("validate error");
  }
}

@Schema({ collection: "pm_prefail" })
class PreFail extends Entity {
  @Prop(() => String) name?: string;

  @Pre("query.find") fail(this: OperationHookContext<PreFail>): void {
    throw new Error("test");
  }
  @Post("query.find") after(this: OperationHookContext<PreFail>): void {
    C.bump("post");
  }
  @PostError("query.find") handler(this: OperationHookContext<PreFail>, error: unknown): never {
    expect((error as Error).message).toBe("test");
    throw new Error("test2");
  }
}

describe("error handlers (ported from test/query.middleware.test.js)", () => {
  // ported from mongoose test/query.middleware.test.js:357 "error handlers (gh-2284)"
  test("error handlers (gh-2284)", async () => {
    const Books = t.connection.model(Titled);
    await Books.createIndexes();
    const books = await Books.create([
      { title: "Professional AngularJS" },
      { title: "The 80/20 Guide to ES2015 Generators" },
    ]);
    const err = await Books.updateOne({ _id: books[1]?._id as never }, { $set: { title: "Professional AngularJS" } })
      .exec()
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect((err as Error).message).toBe("woops");
    expect(C.seen[0]).toBeTruthy();
  });

  // ported from mongoose test/query.middleware.test.js:380 "error handlers for validate (gh-4885)"
  test("error handlers for validate (gh-4885)", async () => {
    const Tests = t.connection.model(RequiredTitle);
    await Tests.create({} as never).catch(() => undefined);
    expect(C.n["validate error"]).toBe(1);
  });

  // ported from mongoose test/query.middleware.test.js:436 "error handlers with error from pre hook (gh-4927)"
  test("error handlers with error from pre hook (gh-4927)", async () => {
    const Tests = t.connection.model(PreFail);
    const error = await Tests.find()
      .exec()
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect((error as Error).message).toBe("test2");
    expect(C.n.post).toBeUndefined();
  });
});

// ---- document vs query events, skip -----------------------------------------------------------------

@Schema({ collection: "pm_deletes" })
class Deletable extends Entity {
  @Prop(() => String) name?: string;

  @Pre("document.deleteOne") docPre(this: Deletable): void {
    C.bump("document pre");
    C.seen.push(this);
  }
  @Post("document.deleteOne") docPost(this: Deletable): void {
    expect(this.name).toBe("foo");
    C.bump("document post");
  }
  @Pre("query.deleteOne") queryPre(this: OperationHookContext<Deletable>): void {
    C.bump("query pre");
  }
}

@Schema({ collection: "pm_cached" })
class Cached extends Entity {
  @Prop(() => String) name?: string;

  @Pre("query.find") cache(this: OperationHookContext<Cached, "query.find">): void {
    this.skip([{ _id: new ObjectId(), name: "from cache" }]);
  }
  @Post("query.find") stamp(this: OperationHookContext<Cached>, res: readonly unknown[]): void {
    for (const doc of res as { $locals(): Record<string, unknown> }[]) doc.$locals().loadedAt = 42;
  }
}

describe("document and query events, skip", () => {
  // ported from mongoose test/query.middleware.test.js:497 "deleteOne with `document: true` but no `query` (gh-8555)"
  test("deleteOne with document hooks only fires for the document (gh-8555)", async () => {
    const Model = t.connection.model(Deletable);
    const doc = await Model.create({ name: "foo" });
    await doc.$deleteOne();
    expect(C.n["document pre"]).toBe(1);
    expect(C.seen[0]).toBe(doc);
    await Model.deleteOne({ name: "none" });
    expect(C.n["document pre"]).toBe(1);
  });

  // ported from mongoose test/model.middleware.test.js:418 "deleteOne hooks (gh-7538)"
  // DIVERGENCE: Mongoose's doc.deleteOne() ALSO runs the query `deleteOne` hooks (queryPreCalled = 1);
  // in Typemo a document's delete runs its document hooks only.
  test("deleteOne hooks (gh-7538)", async () => {
    const Model = t.connection.model(Deletable);
    await Model.create({ name: "foo" });
    const doc = await Model.findOne();
    expect(C.n["document pre"]).toBeUndefined();
    await doc?.$deleteOne();
    expect(C.n["query pre"]).toBeUndefined(); // Mongoose: 1
    expect(C.n["document pre"]).toBe(1);
    expect(C.n["document post"]).toBe(1);
    await Model.deleteOne({ name: "x" });
    expect(C.n["query pre"]).toBe(1); // Mongoose: 2
    expect(C.n["document pre"]).toBe(1);
  });

  // ported from mongoose test/query.middleware.test.js:545 "allows skipping the wrapped function with `skipMiddlewareFunction()` (gh-11426)"
  test("allows skipping the wrapped function (gh-11426): skip(result)", async () => {
    const Tests = t.connection.model(Cached);
    const res = await Tests.find();
    expect(res.length).toBe(1);
    expect(res[0]?.name).toBe("from cache");
    expect(res[0]?.$locals().loadedAt).toBe(42);
  });

  // ported from mongoose test/query.middleware.test.js:517 "allows registering middleware for all queries with regexp (gh-9190)"
  // (no regexp events: the list of query events is explicit)
  test("query hooks fire for queries, not for create/insertMany/aggregate (gh-9190)", async () => {
    @Schema({ collection: "pm_all_queries" })
    class AllQueries extends Entity {
      @Prop(() => String) name?: string;
      @Pre(["query.find", "query.findOne", "query.countDocuments"])
      any(this: OperationHookContext<AllQueries>): void {
        C.bump("query");
      }
    }
    const Model = t.connection.model(AllQueries);
    await Model.find();
    expect(C.n.query).toBe(1);
    await Model.findOne();
    expect(C.n.query).toBe(2);
    await Model.countDocuments();
    expect(C.n.query).toBe(3);
    await Model.create({ name: "test" });
    await Model.insertMany([{ name: "test" }]);
    await Model.aggregate((p) => p.match({ name: "test" }));
    expect(C.n.query).toBe(3);
  });
});

// ---- model middleware --------------------------------------------------------------------------------

@Schema()
class Child extends Entity {
  @Prop(() => String) name?: string;
  @Pre("document.save") childPre(this: Child): void {
    C.bump("child");
    C.bump(`child ${this.name}`);
  }
}

@Schema({ collection: "pm_parents" })
class Parent extends Entity {
  @Prop(() => String) name?: string;
  @Prop(() => [Child]) children?: Child[];
  @Pre("document.save") parentPre(): void {
    C.bump("parent");
  }
}

@Schema({ collection: "pm_saves" })
class Saved extends Entity {
  @Prop(() => String) title?: string;
  @Post("document.save") first(this: Saved, obj: Saved): void {
    expect(obj.title).toBe("Little Green Running Hood");
    expect(this.title).toBe("Little Green Running Hood");
    expect(C.n.post ?? 0).toBe(0);
    C.bump("post");
  }
  @Post("document.save") second(this: Saved, obj: Saved): void {
    expect(obj.title).toBe("Little Green Running Hood");
    expect(C.n.post).toBe(1);
    C.bump("post");
  }
}

@Schema({ collection: "pm_ordering" })
class Ordering extends Entity {
  @Prop(() => String) title?: string;
  @Pre("document.validate") validate(): void {
    C.seen.push("validate");
  }
  @Pre("document.save") save(): void {
    C.seen.push("save");
  }
}

@Schema({ collection: "pm_versioned" })
class Alice extends Versioned(Entity) {
  @Prop(() => String) name?: string;
  @Prop(() => [String]) arr?: string[];
  @PostError("document.save") saveError(this: Alice, error: unknown): void {
    C.seen.push([(error as Error).name, this]);
  }
}

@Schema({ collection: "pm_bulk" })
class Bulk extends Entity {
  @Prop(() => String) name?: string;
  @Prop(() => String) prop?: string;
  @Pre("model.bulkWrite") pre(this: OperationHookContext<Bulk>): void {
    C.seen.push(["pre", this.operations]);
  }
  @Post("model.bulkWrite") post(this: OperationHookContext<Bulk>, res: unknown): void {
    C.seen.push(["post", res]);
  }
  @PostError("model.bulkWrite") error(this: OperationHookContext<Bulk>, err: unknown): void {
    C.seen.push(["error", (err as Error).name]);
  }
}

describe("model middleware (ported from test/model.middleware.test.js)", () => {
  // ported from mongoose test/model.middleware.test.js:29 "post save"
  test("post save", async () => {
    const Tests = t.connection.model(Saved);
    const doc = Tests.new({ title: "Little Green Running Hood" });
    await doc.$save();
    expect(doc.title).toBe("Little Green Running Hood");
    expect(C.n.post).toBe(2);
  });

  // ported from mongoose test/model.middleware.test.js:132 "validate middleware runs before save middleware (gh-2462)"
  // DIVERGENCE: Typemo validates AFTER pre('save') (a change made by a pre-save hook is validated), so
  // the order is save → validate; Mongoose runs validate first.
  test("validate and save middleware order (gh-2462) — save, then validate", async () => {
    await t.connection.model(Ordering).create({});
    expect(C.seen).toEqual(["save", "validate"]);
  });

  // ported from mongoose test/model.middleware.test.js:233 "gh-1829"
  test("gh-1829: subdocument pre('save') hooks run for every child, every save", async () => {
    const Parents = t.connection.model(Parent);
    const parent = Parents.new({ name: "Han", children: [{ name: "Jaina" }, { name: "Jacen" }] });
    await parent.$save();
    expect(C.n.child).toBe(2);
    expect(C.n["child Jaina"]).toBe(1);
    expect(C.n["child Jacen"]).toBe(1);
    expect(C.n.parent).toBe(1);
    parent.children?.[0]?.$set("name", "Anakin");
    await parent.$save();
    expect(C.n.child).toBe(4);
    expect(C.n["child Anakin"]).toBe(1);
    expect(C.n["child Jaina"]).toBe(1);
    expect(C.n["child Jacen"]).toBe(2);
    expect(C.n.parent).toBe(2);
  });

  // ported from mongoose test/model.middleware.test.js:571 "post save error handler gets doc as param (gh-15480)"
  // (the document is `this` of a Typemo document hook)
  // The stale save is a positional array write (the version guards it without `optimisticConcurrency`, like
  // Mongoose's default); the original's `$unset` of the array is replaced by a push that bumps the version.
  test("post save error handler gets the document (gh-15480)", async () => {
    const Users = t.connection.model(Alice);
    const original = await Users.create({ name: "Alice", arr: ["a"] });
    const docA = await Users.findById(original._id).orFail();
    const docB = await Users.findById(original._id).orFail();
    docA.arr?.push("b");
    await docA.$save();
    docB.arr?.set(0, "z");
    const err = await docB.$save().then(
      () => null,
      (error: unknown) => error,
    );
    expect(err).toBeInstanceOf(VersionError);
    expect(C.seen.length).toBe(1);
    expect((C.seen[0] as [string, unknown])[0]).toBe("VersionError");
    expect((C.seen[0] as [string, unknown])[1]).toBe(docB);
  });

  // ported from mongoose test/model.middleware.test.js:496 "calls bulkWrite hooks"
  test("calls bulkWrite hooks", async () => {
    const Tests = t.connection.model(Bulk);
    await Tests.bulkWrite([{ updateOne: { filter: { name: "foo" }, update: { $set: { name: "bar" } } } }]);
    const [pre, post] = C.seen as [string, unknown][];
    expect(pre?.[0]).toBe("pre");
    expect((pre?.[1] as unknown[] | undefined)?.length).toBe(1);
    expect(post?.[0]).toBe("post");
    expect(post?.[1]).toMatchObject({ matchedCount: 0, modifiedCount: 0 });
  });

  // ported from mongoose test/model.middleware.test.js:545 "supports error handlers"
  test("bulkWrite: supports error handlers", async () => {
    const Tests = t.connection.model(Bulk);
    const { _id } = await Tests.create({ name: "baz" });
    C.seen = [];
    await expect(Tests.bulkWrite([{ insertOne: { document: { _id } as never } }])).rejects.toThrow(/duplicate key/);
    expect(C.seen.filter((entry) => (entry as unknown[])[0] === "error")).toEqual([["error", "BulkWriteError"]]);
  });
});

// ---- aggregate middleware ---------------------------------------------------------------------------

@Schema({ collection: "pm_agg" })
class Agg extends Entity {
  @Prop(() => String) name?: string;
  @Pre("aggregate") pre(this: OperationHookContext<Agg>): Promise<void> {
    C.bump("pre");
    return Promise.resolve();
  }
  @Post("aggregate") post(this: OperationHookContext<Agg>, res: readonly unknown[]): void {
    C.bump("post");
    C.seen.push(res);
  }
  @PostError("aggregate") error(this: OperationHookContext<Agg>, error: unknown): void {
    C.seen.push(error);
  }
}

describe("aggregate middleware (ported from test/aggregate.test.js 'middleware (gh-5251)')", () => {
  // ported from mongoose test/aggregate.test.js:903 "pre"
  test("pre", async () => {
    const res = await t.connection.model(Agg).aggregate((p) => p.match({ name: "test" }));
    expect(res).toEqual([]);
    expect(C.n.pre).toBe(1);
  });

  // ported from mongoose test/aggregate.test.js:959 "post"
  test("post", async () => {
    const res = await t.connection.model(Agg).aggregate((p) => p.match({ name: "test" }));
    expect(res).toEqual([]);
    expect(C.n.post).toBe(1);
    expect(C.seen[0]).toEqual([]);
  });

  // ported from mongoose test/aggregate.test.js:1021 "with agg cursor"
  // DIVERGENCE (symmetry with the other hooks): Mongoose calls no post hook for a cursor (calledPost = 0); Typemo calls
  // post per driver batch, and once with no rows for a cursor that found nothing.
  test("with agg cursor", async () => {
    let numDocs = 0;
    await t.connection
      .model(Agg)
      .aggregate((p) => p.match({ name: "test" }))
      .cursor()
      .eachAsync(() => {
        ++numDocs;
      });
    expect(numDocs).toBe(0);
    expect(C.n.pre).toBe(1);
    expect(C.n.post).toBe(1); // Mongoose: 0
  });

  // ported from mongoose test/aggregate.test.js:1048 "with explain() (gh-5887)"
  test("with explain() (gh-5887)", async () => {
    await t.connection
      .model(Agg)
      .aggregate((p) => p.match({ name: "test" }))
      .explain();
    expect(C.n.pre).toBe(1);
    expect(C.n.post).toBe(1);
  });
});
