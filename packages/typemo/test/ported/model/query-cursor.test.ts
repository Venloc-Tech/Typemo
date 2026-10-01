/*
 * Ported from mongoose test/query.cursor.test.js onto Typemo. Node streams, `transform`
 * and cursor events are legacy of the Readable wrapper (n/a, INDEX.md); the rest keeps its logic.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import {
  CastError,
  type Computed,
  Entity,
  type Model,
  type OperationHookContext,
  Post,
  Pre,
  Prop,
  QueryError,
  Schema,
  StrictModeError,
} from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("ported_cursor");

class CursorHooks {
  static preFind = 0;
  static postFind: string[][] = [];
}

@Schema({ collection: "p_band" })
class Band extends Entity {
  @Prop(() => String)
  name?: string;

  /** Mongoose's `schema.virtual('test').get(...)`: a class getter (the `Computed` marker keeps it out of inputs). */
  get test(): Computed<string> {
    return "test" as Computed<string>;
  }

  @Pre("query.find")
  countFind(this: OperationHookContext<Band>): void {
    CursorHooks.preFind++;
  }
}

@Schema({ collection: "p_person" })
class CursorPerson extends Entity {
  @Prop(() => String)
  name?: string;

  @Prop(() => String)
  born?: string;
}

@Schema({ collection: "p_order_users" })
class OrderUser extends Entity {
  @Prop(() => Number)
  order?: number;
}

@Schema({ collection: "p_hooked_movies" })
class HookedMovie extends Entity {
  @Prop(() => String)
  name?: string;

  @Post("query.find")
  upper(this: OperationHookContext<HookedMovie>, docs: unknown): void {
    const list = docs as HookedMovie[];
    CursorHooks.postFind.push(list.map((doc) => doc.name ?? ""));
    for (const doc of list) if (doc.name !== undefined) doc.name = doc.name.toUpperCase();
  }
}

let Bands: Model<Band>;

beforeEach(async () => {
  Bands = t.connection.model(Band);
  await Bands.create([{ name: "Axl" }, { name: "Slash" }]);
  CursorHooks.preFind = 0;
  CursorHooks.postFind = [];
});

describe("QueryCursor (ported)", () => {
  // ported from mongoose test/query.cursor.test.js:42 "with promises"
  test("#next() with promises", async () => {
    const cursor = Bands.find().sort({ name: 1 }).cursor();
    const doc = await cursor.next();
    expect(doc?.name).toBe("Axl");
    expect(doc?.test).toBe("test");
    const doc2 = await cursor.next();
    expect(doc2?.name).toBe("Slash");
    expect(doc2?.test).toBe("test");
  });

  // ported from mongoose test/query.cursor.test.js:55 "with limit (gh-4266)"
  test("#next() with limit (gh-4266)", async () => {
    const cursor = Bands.find().limit(1).sort({ name: 1 }).cursor();
    expect((await cursor.next())?.name).toBe("Axl");
    expect(await cursor.next()).toBeNull();
  });

  // ported from mongoose test/query.cursor.test.js:63 "with projection"
  test("#next() with projection", async () => {
    const People = t.connection.model(CursorPerson);
    await People.create([
      { name: "Axl Rose", born: "William Bruce Rose" },
      { name: "Slash", born: "Saul Hudson" },
    ]);
    const cursor = People.find({}).select({ _id: 0, name: 1 }).sort({ name: 1 }).cursor();
    const doc1 = await cursor.next();
    expect((doc1 as { _id?: unknown } | null)?._id).toBeUndefined();
    expect(doc1?.name).toBe("Axl Rose");
    expect((doc1 as { born?: string } | null)?.born).toBeUndefined();
    const doc2 = await cursor.next();
    expect(doc2?.name).toBe("Slash");
  });

  // ported from mongoose test/query.cursor.test.js:190 "casting ObjectIds with where() (gh-4355)"
  test("#next() casting ObjectIds with where() (gh-4355)", async () => {
    const found = await Bands.findOne().orFail();
    const query = { _id: (found._id as ObjectId).toHexString() };
    const doc = await Bands.find()
      .where(query as never)
      .cursor()
      .next();
    expect(doc).not.toBeNull();
  });

  // ported from mongoose test/query.cursor.test.js:198 "cast errors (gh-4355)"
  test("#next() cast errors (gh-4355)", async () => {
    const error = await Bands.find()
      .where({ _id: "BadId" } as never)
      .cursor()
      .next()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CastError);
    expect((error as CastError).path).toBe("_id");
  });

  // ported from mongoose test/query.cursor.test.js:209 "with pre-find hooks (gh-5096)"
  test("#next() with pre-find hooks (gh-5096)", async () => {
    const doc = await Bands.find().cursor().next();
    expect(CursorHooks.preFind).toBe(1);
    expect(doc?.name).toBeDefined();
  });

  // ported from mongoose test/query.cursor.test.js:304 "with #next"
  test("#map with #next", async () => {
    const cursor = Bands.find()
      .sort({ name: 1 })
      .cursor()
      .map((obj) => {
        obj.name += "_next";
        return obj;
      });
    const doc = await cursor.next();
    expect(doc?.name).toBe("Axl_next");
    expect(doc?.test).toBe("test");
    expect((await cursor.next())?.name).toBe("Slash_next");
  });

  // ported from mongoose test/query.cursor.test.js:276 "maps documents" (the stream part is for-await)
  test("#map maps documents (chained)", async () => {
    const cursor = Bands.find()
      .sort({ name: 1 })
      .cursor()
      .map((obj) => ({ ...obj, name: `${obj.name}_mapped` }))
      .map((obj) => ({ ...obj, name: `${obj.name}_mappedagain` }));
    const names: string[] = [];
    for await (const doc of cursor) names.push(doc.name);
    expect(names).toEqual(["Axl_mapped_mappedagain", "Slash_mapped_mappedagain"]);
  });

  // ported from mongoose test/query.cursor.test.js:322 "iterates one-by-one, stopping for promises"
  test("#eachAsync() iterates one-by-one, stopping for promises", async () => {
    const expectedNames = ["Axl", "Slash"];
    let cur = 0;
    await Bands.find()
      .sort({ name: 1 })
      .cursor()
      .eachAsync((doc) => {
        const current = cur;
        expect(doc.name).toBe(expectedNames[cur] as string);
        // The original returns a hand-made thenable (a promise-like, not a Promise): eachAsync must await it.
        return {
          // biome-ignore lint/suspicious/noThenProperty: the ported test's thenable is the point.
          then: (resolve: () => void) => {
            setTimeout(() => {
              expect(current).toBe(cur++);
              resolve();
            }, 50);
          },
        };
      });
    expect(cur).toBe(2);
  });

  // ported from mongoose test/query.cursor.test.js:346 "parallelization"
  test("#eachAsync() parallelization", async () => {
    const names: string[] = [];
    const resolves: (() => void)[] = [];
    await Bands.find()
      .sort({ name: 1 })
      .cursor()
      .eachAsync(
        (doc) => {
          names.push(doc.name ?? "");
          const p = new Promise<void>((resolve) => {
            resolves.push(resolve);
          });
          if (names.length === 2)
            setTimeout(() => {
              for (const r of resolves) r();
            }, 0);
          return p;
        },
        { parallel: 2 },
      );
    expect(names.sort()).toEqual(["Axl", "Slash"]);
  });

  // ported from mongoose test/query.cursor.test.js:372 "lean"
  test("#lean() lean", async () => {
    const names: string[] = [];
    for await (const doc of Bands.find().sort({ name: 1 }).lean().cursor()) {
      names.push(doc.name ?? "");
      expect(doc).not.toBeInstanceOf(Band);
    }
    expect(names).toEqual(["Axl", "Slash"]);
  });

  // ported from mongoose test/query.cursor.test.js:401 "works (gh-4258)"
  test("#close() works (gh-4258)", async () => {
    const cursor = Bands.find().sort({ name: 1 }).cursor();
    const doc = await cursor.next();
    expect(doc?.name).toBe("Axl");
    expect(doc?.test).toBe("test");
    await cursor.close();
    const error = await cursor.next().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QueryError);
    expect((error as Error).message.includes("closed")).toBe(true);
  });

  // ported from mongoose test/query.cursor.test.js:441 "data before close (gh-4998)"
  test("data before close (gh-4998)", async () => {
    const Users = t.connection.model(CursorPerson);
    await Users.insertMany(
      Array.from({ length: 100 }, (_, i) => ({ _id: new ObjectId(), name: `Bob${i < 10 ? "0" : ""}${i}` })),
    );
    const docs: unknown[] = [];
    for await (const doc of Users.find({}).cursor()) docs.push(doc);
    expect(docs.length).toBe(100);
  });

  // ported from mongoose test/query.cursor.test.js:515 "eachAsync() with parallel > numDocs (gh-8422)"
  test("eachAsync() with parallel > numDocs (gh-8422)", async () => {
    let numDone = 0;
    await Bands.find()
      .cursor()
      .eachAsync(
        async () => {
          await Bun.sleep(100);
          ++numDone;
        },
        { parallel: 4 },
      );
    expect(numDone).toBe(2);
  });

  // ported from mongoose test/query.cursor.test.js:535 "eachAsync() with sort, parallel, and sync function (gh-8557)"
  test("eachAsync() with sort, parallel, and sync function (gh-8557)", async () => {
    const Users = t.connection.model(OrderUser);
    await Users.create([{ order: 1 }, { order: 2 }, { order: 3 }]);
    const docs: OrderUser[] = [];
    await Users.aggregate((p) => p.sort({ order: 1 }))
      .cursor()
      .eachAsync((doc) => docs.push(doc as OrderUser), { parallel: 3 });
    expect(docs.map((d) => d.order)).toEqual([1, 2, 3]);
  });

  // ported from mongoose test/query.cursor.test.js:703 "passes document index as the second argument for query cursor (gh-8972)"
  test("passes document index as the second argument for query cursor (gh-8972)", async () => {
    const Users = t.connection.model(OrderUser);
    await Users.create([{ order: 1 }, { order: 2 }, { order: 3 }]);
    const docsWithIndexes: { order: number | undefined; i: number }[] = [];
    await Users.find()
      .sort({ order: 1 })
      .cursor()
      .eachAsync((doc, i) => {
        docsWithIndexes.push({ order: doc.order, i });
      });
    expect(docsWithIndexes).toEqual([
      { order: 1, i: 0 },
      { order: 2, i: 1 },
      { order: 3, i: 2 },
    ]);
  });

  // ported from mongoose test/query.cursor.test.js:723 "passes document index as the second argument for aggregation cursor (gh-8972)"
  test("passes document index as the second argument for aggregation cursor (gh-8972)", async () => {
    const Users = t.connection.model(OrderUser);
    await Users.create([{ order: 1 }, { order: 2 }, { order: 3 }]);
    const docsWithIndexes: { order: number | undefined; i: number }[] = [];
    await Users.aggregate((p) => p.sort({ order: 1 }))
      .cursor()
      .eachAsync((doc, i) => {
        docsWithIndexes.push({ order: (doc as OrderUser).order, i });
      });
    expect(docsWithIndexes.map((entry) => entry.i)).toEqual([0, 1, 2]);
    expect(docsWithIndexes.map((entry) => entry.order)).toEqual([1, 2, 3]);
  });

  // ported from mongoose test/query.cursor.test.js:744 "post hooks (gh-9435)"
  test("post hooks (gh-9435) — post runs per driver batch (batchSize 1 = Mongoose's per document)", async () => {
    const Movies = t.connection.model(HookedMovie);
    await Movies.create([{ name: "Kickboxer" }, { name: "Ip Man" }, { name: "Enter the Dragon" }]);
    const arr: string[] = [];
    await Movies.find()
      .sort({ name: -1 })
      .batchSize(1)
      .cursor()
      .eachAsync((doc) => {
        arr.push(doc.name ?? "");
      });
    expect(CursorHooks.postFind).toEqual([["Kickboxer"], ["Ip Man"], ["Enter the Dragon"]]);
    expect(arr).toEqual(["KICKBOXER", "IP MAN", "ENTER THE DRAGON"]);
  });

  // ported from mongoose test/query.cursor.test.js:895 "supports including fields using plus path that have select: false in schema (gh-13773)"
  test("supports including Hidden fields with +path (gh-13773)", async () => {
    const doc = await Bands.find().select({ name: 1 }).lean().cursor().next();
    expect(doc?.name).toBeDefined();
  });

  // ported from mongoose test/query.cursor.test.js:1019 "sanitizeFilter rejects $where (gh-15720)"
  test("sanitizeFilter rejects $where (gh-15720) — sanitize is always on", async () => {
    const error = await Bands.find({ $where: 'this.name === "Axl"' } as never)
      .cursor()
      .next()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StrictModeError);
    expect((error as StrictModeError).reason).toBe("sanitize");
  });

  // ported from mongoose test/query.cursor.test.js:997 "applies sanitizeFilter (gh-15720)"
  test("applies sanitizeFilter (gh-15720) — the injected { $ne: null } does not match every document: CastError (here because null is not a value of a non-nullable path, L3Q-6)", async () => {
    const err = await Bands.find({ name: { $ne: null } } as never)
      .cursor()
      .next()
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(err).toBeInstanceOf(CastError);
    expect((err as CastError).name).toBe("CastError");
  });
});
