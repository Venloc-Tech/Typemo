import { beforeEach, describe, expect, test } from "bun:test";
import { expectShapeMatches, MongoLifecycle } from "@venloc/typemo-test-kit";
import { ObjectId } from "mongodb";
import { BsonOptions, fn, Pipeline, Vars, withWindow } from "../../../src/index.ts";
import { AggregateSeed, Customer, Order, Place, Reading, StatusTotal } from "../../fixtures/aggregate-entities.ts";
import { AggregatePipelines as P } from "../../fixtures/aggregate-pipelines.ts";
import { AggregateFixtures } from "../../fixtures/aggregate-run.ts";

/*
 * The built pipelines run on a real server (through the raw driver) and give the values the
 * stage semantics promise. Rows are typed by the builder (see the shape tests for the type check).
 */

const mongo = MongoLifecycle.useMongo("agg_stages", BsonOptions.apply({}));
const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;

beforeEach(async () => {
  await AggregateFixtures.seed(mongo);
});

describe("stage values", () => {
  test("$match + $sort, $match with $expr, $skip/$limit, $count", async () => {
    expect((await AggregateFixtures.run(mongo, P.matchSort.plan())).map((row) => row.total)).toEqual([25, 12]);
    expect((await AggregateFixtures.run(mongo, P.matchExpr.plan())).map((row) => row.total).sort()).toEqual([25, 30]);
    expect((await AggregateFixtures.run(mongo, P.paging.plan())).map((row) => row.total)).toEqual([30]);
    expect(await AggregateFixtures.run(mongo, P.count.plan())).toEqual([{ paid: 2 }]);
  });

  test("$redact prunes by a typed verdict (Vars.PRUNE / Vars.KEEP)", async () => {
    const rows = await AggregateFixtures.run(mongo, P.redact.plan());
    expect(rows.map((row) => row.status)).toEqual(["paid", "paid"]);
  });

  test("$addFields: computed, dotted and removed fields", async () => {
    const [first] = await AggregateFixtures.run(mongo, P.addFields.plan());
    expect(first?.net).toBeCloseTo(22.5);
    expect(first?.stats.year).toBe(2024);
    expect(first !== undefined && "notes" in first).toBe(false);
  });

  test("a string literal starting with $ is a literal, not a path ($literal is added)", async () => {
    const rows = await AggregateFixtures.run(mongo, P.setLiteral.plan());
    expect(rows.map((row) => row.label).sort()).toEqual(["$12", "$25", "$30"]);
    const [stage] = P.setLiteral.build();
    expect(stage).toEqual({ $set: { label: { $concat: [{ $literal: "$" }, { $toString: "$total" }] } } });
    const [order] = await AggregateFixtures.run(
      mongo,
      Pipeline.from(Order)
        .match({ notes: "$5 off" })
        .project((f) => ({ _id: 0, same: fn.eq(f.notes, "$5 off") }))
        .plan(),
    );
    expect(order).toEqual({ same: true });
  });

  test("$project: include with a dotted path, exclude, computed", async () => {
    expect(await AggregateFixtures.run(mongo, P.projectInclude.plan())).toEqual([
      { _id: AggregateSeed.ann, name: "Ann", address: { city: "Oslo" } },
      { _id: AggregateSeed.bob, name: "Bob" },
      { _id: AggregateSeed.cid, name: "Cid", address: { city: "Rome" } },
    ]);
    const excluded = await AggregateFixtures.run(mongo, P.projectExclude.plan());
    expect(excluded.every((row) => !("email" in row) && !("address" in row))).toBe(true);
    expect(await AggregateFixtures.run(mongo, P.projectComputed.plan())).toContainEqual({
      status: "paid",
      lines: 2,
      label: "paid-25",
    });
  });

  test("$unwind (includeArrayIndex is an int64, empty arrays kept)", async () => {
    expect(await AggregateFixtures.run(mongo, P.unwind.plan())).toHaveLength(3);
    const rows = await AggregateFixtures.run(mongo, P.unwindOptions.plan());
    expect(rows.map((row) => row.position)).toEqual([0n, 1n, 0n, null]);
  });

  test("$group: accumulators and the composite _id without missing keys", async () => {
    const rows = await AggregateFixtures.run(mongo, P.group.sort({ _id: 1 }).plan());
    const paid = rows.find((row) => row._id === "paid");
    expect(paid?.revenue).toBe(37);
    expect(paid?.orders).toBe(2);
    expect(paid?.best).toBe(25);
    expect(paid?.top2).toEqual([25, 12]);
    expect(paid?.points).toBe(10n);
    const composite = await AggregateFixtures.run(mongo, P.groupComposite.plan());
    expect(composite).toContainEqual({ _id: { status: "open", year: 2024 }, n: 1 });
  });

  test("$bucket, $bucketAuto, $sortByCount", async () => {
    expect(await AggregateFixtures.run(mongo, P.bucket.plan())).toEqual([
      { _id: 0, n: 1, totals: [12] },
      { _id: 20, n: 2, totals: [25, 30] },
    ]);
    expect(await AggregateFixtures.run(mongo, P.sortByCount.plan())).toEqual([
      { _id: "paid", count: 2 },
      { _id: "open", count: 1 },
    ]);
  });

  test("$setWindowFields: ranks, shift, bounded windows", async () => {
    const rows = await AggregateFixtures.run(mongo, P.window.plan());
    const paid = rows.filter((row) => row.status === "paid");
    expect(paid.map((row) => row.running)).toEqual([25, 37]);
    expect(paid.map((row) => row.previous)).toEqual([null, 25]);
    expect(paid.map((row) => row.nextOr)).toEqual([12, 0]);
    expect(paid.map((row) => row.all)).toEqual([
      [25, 12],
      [25, 12],
    ]);
  });

  test("$densify and $fill", async () => {
    const densified = await AggregateFixtures.run(mongo, P.densify.plan());
    expect(densified.filter((row) => row.sensor === "s1").map((row) => row.hour)).toEqual([0, 1, 2, 3, 4]);
    const filled = await AggregateFixtures.run(mongo, P.fill.plan());
    expect(filled.find((row) => row.hour === 2)?.value).toBe(3);
  });

  test("$lookup: equality, sub-pipeline with typed let, concise form, $documents, dotted as", async () => {
    const [first] = await AggregateFixtures.run(mongo, P.lookup.plan());
    expect(first?.buyer.name).toBe("Ann");
    const withOrders = await AggregateFixtures.run(mongo, P.lookupPipeline.plan());
    expect(withOrders.map((row) => row.orders.length)).toEqual([2, 1, 0]);
    const concise = await AggregateFixtures.run(mongo, P.lookupConcise.plan());
    expect(concise.map((row) => row.paid)).toEqual([[{ n: 1 }], [{ n: 1 }], []]);
    const docs = await AggregateFixtures.run(mongo, P.lookupDocuments.plan());
    expect(docs[0]?.extra).toEqual([{ k: 1 }, { k: 2 }]);
    const dotted = await AggregateFixtures.run(mongo, P.lookupDotted.plan());
    expect(dotted[0]?.address.orders).toHaveLength(2);
  });

  test("$graphLookup with depthField (int64)", async () => {
    const rows = await AggregateFixtures.run(mongo, P.graphLookup.plan());
    const dev = rows.find((row) => row.name === "Dev");
    expect(dev?.chain.map((row) => [row.name, row.depth]).sort()).toEqual([
      ["Boss", 1n],
      ["Mid", 0n],
    ]);
  });

  test("$unionWith gives a union of document types", async () => {
    const rows = await AggregateFixtures.run(mongo, P.unionWith.plan());
    expect(rows).toHaveLength(6);
    const names = rows.flatMap((row) => ("name" in row ? [row.name] : []));
    expect(names).toEqual(["Ann", "Bob", "Cid"]);
    expect(await AggregateFixtures.run(mongo, P.unionWithDocuments.plan())).toContainEqual({
      total: 0,
      synthetic: true,
    });
  });

  test("$facet and $geoNear", async () => {
    const [facet] = await AggregateFixtures.run(mongo, P.facet.plan());
    expect(facet?.top).toEqual([{ _id: new ObjectId("660000000000000000000002"), total: 30 }]);
    const places = await AggregateFixtures.run(mongo, P.geoNear.plan());
    expect(places[0]?.name).toBe("Near");
    expect(places[0]?.where).toEqual({ type: "Point", coordinates: [10.75, 59.91] });
  });

  test("nested $map keeps the outer element (scope fix) and $reduce folds", async () => {
    const [row] = await AggregateFixtures.run(
      mongo,
      Pipeline.from(Order)
        .limit(1)
        .project((f) => ({
          _id: 0,
          grid: fn.map({
            input: f.items,
            in: (i) => fn.map({ input: f.items, in: (j) => fn.multiply(i.price, j.price) }),
          }),
          sum: fn.reduce({ input: f.items, initialValue: 0, in: (acc, i) => fn.add(acc, i.price) }),
          nested: fn.reduce({
            input: f.items,
            initialValue: 0,
            in: (acc, i) =>
              fn.add(
                acc,
                fn.reduce({
                  input: f.items,
                  initialValue: 0,
                  in: (inner, j) => fn.add(inner, i.price, fn.multiply(0, j.price)),
                }),
              ),
          }),
        }))
        .plan(),
    );
    expect(row).toEqual({
      grid: [
        [100, 50],
        [50, 25],
      ],
      sum: 15,
      nested: 30,
    });
  });
});

describe("server rules the types encode", () => {
  test("window functions that need sortBy fail on the server without it", async () => {
    for (const output of [
      { $rank: {} },
      { $denseRank: {} },
      { $documentNumber: {} },
      { $shift: { output: "$total", by: 1 } },
      { $linearFill: "$discount" },
      { $expMovingAvg: { input: "$total", N: 2 } },
      { $derivative: { input: "$total" } },
      { $integral: { input: "$total" } },
    ]) {
      const error = await AggregateFixtures.errorOf(mongo, {
        op: "aggregate",
        target: { kind: "collection", collection: "agg_orders", entity: undefined, discriminator: undefined },
        pipeline: [{ $setWindowFields: { output: { x: output } } }],
        options: {},
      });
      expect({ output, failed: error !== undefined }).toEqual({ output, failed: true });
    }
  });

  test("$locf needs no sortBy; $derivative needs a window; ranks need exactly one sortBy key (checked at build)", async () => {
    const carried = await AggregateFixtures.run(
      mongo,
      Pipeline.from(Order)
        .setWindowFields({ output: (f) => ({ carried: fn.locf(f.discount) }) })
        .plan(),
    );
    expect(carried).toHaveLength(3);
    const noWindow = await AggregateFixtures.errorOf(mongo, {
      op: "aggregate",
      target: { kind: "collection", collection: "agg_orders", entity: undefined, discriminator: undefined },
      pipeline: [{ $setWindowFields: { sortBy: { total: 1 }, output: { x: { $derivative: { input: "$total" } } } } }],
      options: {},
    });
    expect(noWindow?.message).toContain("window bounds");
    const twoKeys = await AggregateFixtures.errorOf(mongo, {
      op: "aggregate",
      target: { kind: "collection", collection: "agg_orders", entity: undefined, discriminator: undefined },
      pipeline: [{ $setWindowFields: { sortBy: { total: 1, placedAt: 1 }, output: { x: { $rank: {} } } } }],
      options: {},
    });
    expect(twoKeys?.message).toContain("exactly one element");
    expect(() =>
      /* The types refuse this call too; the runtime guard is checked for untyped callers. */
      // @ts-expect-error — $rank needs a sortBy with exactly one field
      Pipeline.from(Order).setWindowFields({ sortBy: { total: 1, placedAt: 1 }, output: () => ({ r: fn.rank() }) }),
    ).toThrow("exactly one field");
  });

  test("$geoNear may start a $lookup sub-pipeline", async () => {
    const rows = await AggregateFixtures.run(
      mongo,
      Pipeline.from(Order)
        .limit(1)
        .lookup({
          from: Place,
          as: "places",
          pipeline: (p) => p.geoNear({ near: [10.7, 59.9], distanceField: "d", spherical: true }).limit(1),
        })
        .plan(),
    );
    expect(rows[0]?.places.map((place) => place.name)).toEqual(["Near"]);
  });

  test("a bounded documents window needs sortBy; [unbounded, unbounded] does not", async () => {
    const run = (window: object) =>
      AggregateFixtures.errorOf(mongo, {
        op: "aggregate",
        target: { kind: "collection", collection: "agg_orders", entity: undefined, discriminator: undefined },
        pipeline: [{ $setWindowFields: { output: { x: { $sum: "$total", window } } } }],
        options: {},
      });
    expect(await run({ documents: ["unbounded", "current"] })).toBeDefined();
    expect(await run({ documents: ["unbounded", "unbounded"] })).toBeUndefined();
    const unsorted = await AggregateFixtures.run(
      mongo,
      Pipeline.from(Order)
        .setWindowFields({
          output: (f) => ({ all: withWindow(fn.sum(f.total), { documents: ["unbounded", "unbounded"] }) }),
        })
        .plan(),
    );
    expect(unsorted.every((row) => row.all === 67)).toBe(true);
  });

  test("a non-accumulator in $group fails on the server (the type rejects it)", async () => {
    const error = await AggregateFixtures.errorOf(mongo, {
      op: "aggregate",
      target: { kind: "collection", collection: "agg_orders", entity: undefined, discriminator: undefined },
      pipeline: [{ $group: { _id: null, x: { $add: ["$total", 1] } } }],
      options: {},
    });
    expect(error?.message).toContain("accumulator");
  });

  test("$geoNear must be the first stage (the type requires an empty builder)", async () => {
    const error = await AggregateFixtures.errorOf(mongo, {
      op: "aggregate",
      target: { kind: "collection", collection: "agg_places", entity: undefined, discriminator: undefined },
      pipeline: [{ $match: { name: { $ne: "x" } } }, P.geoNear.build()[0] ?? {}],
      options: {},
    });
    expect(error?.message).toContain("first stage");
  });

  test("$sigmoid: the server takes the bare form; the documented { input } form fails (divergence)", async () => {
    const [row] = await AggregateFixtures.run(
      mongo,
      Pipeline.from(Order)
        .limit(1)
        .project((f) => ({ _id: 0, s: fn.sigmoid(f.total) }))
        .plan(),
    );
    expect(row?.s).toBeCloseTo(1);
    const error = await AggregateFixtures.errorOf(mongo, {
      op: "aggregate",
      target: { kind: "collection", collection: "agg_orders", entity: undefined, discriminator: undefined },
      pipeline: [{ $project: { s: { $sigmoid: { input: "$total" } } } }],
      options: {},
    });
    expect(error?.message).toContain("$multiply only supports numeric types");
  });
});

describe("statistics, sessions and database stages", () => {
  test("$collStats has the requested sections", async () => {
    const [stats] = await AggregateFixtures.run(mongo, P.collStats.plan());
    expect(stats?.ns.endsWith(".agg_orders")).toBe(true);
    expect(stats?.localTime).toBeInstanceOf(Date);
    expect(stats?.storageStats.count).toBe(3);
    /* The server writes a small count as int32 (a number here); the type stays `StatNumber` because a large
       one is written as int64 (a bigint with the enforced driver options). */
    expect(stats?.count).toBe(3);
    const [kinds] = await mongo.db
      .collection("agg_orders")
      .aggregate([{ $collStats: { count: {} } }, { $project: { _id: 0, count: { $type: "$count" } } }])
      .toArray();
    expect(kinds).toEqual({ count: "int" });
  });

  test("$indexStats, $planCacheStats, $currentOp, $listLocalSessions, $listClusterCatalog", async () => {
    const indexes = await AggregateFixtures.run(mongo, P.indexStats.plan());
    expect(indexes.map((row) => typeof row.accesses.ops)).toEqual(["bigint"]);
    await mongo.db.collection("agg_orders").find({ status: "paid", customer: AggregateSeed.bob }).toArray();
    await mongo.db.collection("agg_orders").find({ status: "paid", customer: AggregateSeed.bob }).toArray();
    const plans = await AggregateFixtures.run(mongo, P.planCacheStats.plan());
    expect(plans.every((row) => row.works === undefined || typeof row.works === "bigint")).toBe(true);
    const ops = await AggregateFixtures.run(mongo, P.currentOp.plan());
    expect(ops.every((row) => typeof row.type === "string")).toBe(true);
    await mongo.db.command({ ping: 1 });
    expect(Array.isArray(await AggregateFixtures.run(mongo, P.listLocalSessions.plan()))).toBe(true);
    const catalog = await AggregateFixtures.run(mongo, P.listClusterCatalog.plan());
    expect(catalog.some((row) => row.ns.endsWith(".agg_orders") && row.type === "collection")).toBe(true);
  });

  test("$documents in a database aggregation; $queryStats and $querySettings on admin", async () => {
    expect(await AggregateFixtures.run(mongo, P.documents.plan())).toEqual([
      { a: 1, b: "x" },
      { a: 2, b: "y" },
    ]);
    expect(Array.isArray(await AggregateFixtures.run(mongo, P.queryStats.plan()))).toBe(true);
    expect(Array.isArray(await AggregateFixtures.run(mongo, P.querySettings.plan()))).toBe(true);
  });

  test("$listSessions on config.system.sessions (Pipeline.sessions())", async () => {
    const rows = await AggregateFixtures.run(mongo, Pipeline.sessions().listSessions({ allUsers: true }).plan());
    expect(Array.isArray(rows)).toBe(true);
  });

  test("Atlas/sharding-only stages reach the server and are refused by this deployment (typed on input only)", async () => {
    const refused: Record<string, boolean> = {};
    const tries: Record<string, object[]> = {
      search: Pipeline.from(Order)
        .search({ text: { query: "paid", path: "status" } })
        .build() as object[],
      searchMeta: Pipeline.from(Order)
        .searchMeta({ exists: { path: "status" } })
        .build() as object[],
      vectorSearch: Pipeline.from(Order)
        .vectorSearch({ index: "v", path: "total", queryVector: [1, 2], limit: 1, numCandidates: 5 })
        .build() as object[],
      listSearchIndexes: Pipeline.from(Order).listSearchIndexes().build() as object[],
    };
    for (const [name, pipeline] of Object.entries(tries)) {
      const error = await mongo.db
        .collection("agg_orders")
        .aggregate(pipeline)
        .toArray()
        .then(
          () => undefined,
          (e: Error) => e,
        );
      refused[name] = error !== undefined;
    }
    for (const [name, pipeline] of Object.entries({
      shardedDataDistribution: Pipeline.admin().shardedDataDistribution().build(),
    })) {
      const error = await mongo.client
        .db("admin")
        .aggregate([...pipeline])
        .toArray()
        .then(
          () => undefined,
          (e: Error) => e,
        );
      refused[name] = error !== undefined;
    }
    expect(refused).toEqual({
      search: true,
      searchMeta: true,
      vectorSearch: true,
      listSearchIndexes: true,
      shardedDataDistribution: true,
    });
  });

  test("$rankFusion / $scoreFusion / $score run on this server", async () => {
    const results: Record<string, string> = {};
    const plans = {
      rankFusion: Pipeline.from(Order).rankFusion({
        input: { pipelines: { byTotal: (p) => p.sort({ total: -1 }), byDate: (p) => p.sort({ placedAt: 1 }) } },
      }),
      scoreFusion: Pipeline.from(Order).scoreFusion({
        input: {
          pipelines: { a: (p) => p.score({ score: (f) => f.total }), b: (p) => p.score({ score: () => 1 }) },
          normalization: "none",
        },
      }),
      score: Pipeline.from(Order).score({ score: (f) => f.total, normalization: "none" }),
    };
    for (const [name, builder] of Object.entries(plans)) {
      const error = await AggregateFixtures.errorOf(mongo, builder.plan());
      results[name] = error === undefined ? "ok" : `refused ${error.code}: ${error.message.slice(0, 80)}`;
    }
    expect(results).toEqual({ rankFusion: "ok", scoreFusion: "ok", score: "ok" });
  });
});

describe("change streams, terminal stages, views, update pipelines", () => {
  test("$changeStream (first stage) and a watch pipeline with $changeStreamSplitLargeEvent", async () => {
    const collection = mongo.db.collection("agg_orders");
    const stream = collection.watch([
      ...Pipeline.watch(Order)
        .match({ operationType: "insert" })
        .project((f) => ({ fullDocument: 1, operationType: 1, marker: fn.literal(1), id: f._id }))
        .build(),
    ]);
    const next = stream.next();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await collection.insertOne({ status: "open", total: 1 });
    /* cast: a raw collection.watch() event with the pipeline's extra field */
    const event = (await next) as unknown as { operationType: string; marker: number };
    expect(event.operationType).toBe("insert");
    expect(event.marker).toBe(1);
    await stream.close();
    const split = Pipeline.watch(Order).changeStreamSplitLargeEvent().build();
    expect(split).toEqual([{ $changeStreamSplitLargeEvent: {} }]);
    const splitStream = collection.watch([...split]);
    const splitNext = splitStream.next();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await collection.insertOne({ status: "paid", total: 2 });
    /* cast: a raw collection.watch() event */
    expect(((await splitNext) as unknown as { operationType: string }).operationType).toBe("insert");
    await splitStream.close();
    const asStage = Pipeline.from(Order).changeStream({ fullDocument: "updateLookup" }).build();
    const reply = await mongo.db.command({ aggregate: "agg_orders", pipeline: [...asStage], cursor: {} });
    expect(reply.ok).toBe(1);
    await mongo.db.command({ killCursors: "agg_orders", cursors: [reply.cursor.id] });
  });

  test("$out and $merge into an entity collection: the stored rows fit the entity", async () => {
    await AggregateFixtures.run(mongo, P.out.plan());
    const stored = await mongo.db
      .collection<{ _id: string; revenue: number; orders: number }>("agg_status_totals")
      .find()
      .sort({ _id: 1 })
      .toArray();
    expect(stored).toEqual([
      { _id: "open", revenue: 30, orders: 1 },
      { _id: "paid", revenue: 37, orders: 2 },
    ]);
    await AggregateFixtures.run(mongo, P.merge.plan());
    const merged = await mongo.db
      .collection<{ _id: string; revenue: number; orders: number }>("agg_status_totals")
      .find()
      .sort({ _id: 1 })
      .toArray();
    expect(merged.map((row) => row.revenue)).toEqual([60, 74]);
    expectShapeMatches(
      {
        code: 'import type { PipelineDoc } from "@venloc/typemo"; import type { StatusTotal } from "./aggregate-entities.ts"; export type Row = PipelineDoc<StatusTotal>[];',
        type: "Row",
        dir: FIXTURES,
      },
      merged,
    );
  });

  test("a view definition reads rows of the view class", async () => {
    class OrderSummary extends StatusTotal {}
    const view = Pipeline.view(OrderSummary, {
      on: Order,
      pipeline: (p) => p.group((f) => ({ _id: f.status, revenue: fn.sum(f.total), orders: fn.count() })),
    });
    await mongo.db.createCollection("agg_order_summary", { viewOn: view.viewOn, pipeline: [...view.pipeline] });
    const rows = await mongo.db
      .collection<{ _id: string; revenue: number; orders: number }>("agg_order_summary")
      .find()
      .sort({ _id: 1 })
      .toArray();
    expect(rows).toEqual([
      { _id: "open", revenue: 30, orders: 1 },
      { _id: "paid", revenue: 37, orders: 2 },
    ]);
  });

  test("an update pipeline (mode update) is accepted by updateMany", async () => {
    const pipeline = Pipeline.update(Order)
      .set((f) => ({ total: fn.multiply(f.total, 2), flagged: fn.gt(f.total, 20) }))
      .unset("notes")
      .build();
    await mongo.db.collection("agg_orders").updateMany({}, [...pipeline]);
    const rows = await mongo.db.collection("agg_orders").find().sort({ _id: 1 }).toArray();
    expect(rows.map((row) => [row.total, row.flagged, "notes" in row])).toEqual([
      [50, true, false],
      [60, true, false],
      [24, false, false],
    ]);
  });

  test("$fill by value and $densify on dates reach the server with the typed range", async () => {
    const rows = await AggregateFixtures.run(mongo, P.fillValue.plan());
    expect(rows.map((row) => row.value)).toEqual([1, 0, 5, 2]);
    const dated = await AggregateFixtures.run(
      mongo,
      Pipeline.from(Customer)
        .densify({ field: "since", range: { step: 1, unit: "year", bounds: "full" } })
        .plan(),
    );
    expect(dated.length).toBeGreaterThan(3);
    const nulls = await AggregateFixtures.run(
      mongo,
      Pipeline.from(Reading)
        .match((f) => fn.eq(f.value, null))
        .plan(),
    );
    expect(nulls.map((row) => row.hour)).toEqual([2]);
    void Vars.NOW;
  });
});

describe("metadata", () => {
  test("fn.meta reads the text score of a $text match", async () => {
    await mongo.db.collection("agg_orders").createIndex({ status: "text" });
    const rows = await AggregateFixtures.run(
      mongo,
      Pipeline.from(Order)
        .match({ $text: { $search: "open" } })
        .project((f) => ({ _id: 0, status: f.status, score: fn.meta("textScore") }))
        .plan(),
    );
    expect(rows).toHaveLength(1);
    expect(typeof rows[0]?.score).toBe("number");
    await mongo.db.collection("agg_orders").dropIndex("status_text");
  });
});
