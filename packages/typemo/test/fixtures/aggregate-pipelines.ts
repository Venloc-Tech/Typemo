/*
 * Named pipelines over the aggregation fixtures. The runtime tests run each through the raw
 * driver; the shape tests compare the rows with `RowOf<typeof AggregatePipelines.<name>>`, so a pipeline is
 * written once and checked both ways.
 */
import { fn, Pipeline, Vars, withWindow } from "../../src/index.ts";
import { Customer, Employee, Order, Place, Reading, StatusTotal } from "./aggregate-entities.ts";

/** One static pipeline per aggregation stage or stage family, grouped by purpose. */
export class AggregatePipelines {
  /* filtering, ordering, paging */
  static readonly matchSort = Pipeline.from(Order).match({ status: "paid" }).sort({ total: -1 });
  static readonly matchExpr = Pipeline.from(Order).match((f) => fn.gt(f.total, 20));
  static readonly paging = Pipeline.from(Order).sort({ placedAt: 1 }).skip(1).limit(1);
  static readonly sample = Pipeline.from(Order).sample(2);
  static readonly count = Pipeline.from(Order).match({ status: "paid" }).count("paid");
  static readonly redact = Pipeline.from(Order).redact((f) => fn.cond(fn.eq(f.status, "open"), Vars.PRUNE, Vars.KEEP));

  /* reshaping */
  static readonly addFields = Pipeline.from(Order).addFields((f) => ({
    net: fn.multiply(f.total, fn.subtract(1, fn.ifNull(f.discount, 0))),
    "stats.year": fn.year(f.placedAt),
    notes: fn.remove(),
  }));
  static readonly setLiteral = Pipeline.from(Order).set((f) => ({ label: fn.concat("$", fn.toString_(f.total)) }));
  static readonly projectInclude = Pipeline.from(Customer).project({ name: 1, "address.city": 1 });
  static readonly projectExclude = Pipeline.from(Customer).project({ email: 0, address: 0 });
  static readonly projectComputed = Pipeline.from(Order).project((f) => ({
    _id: 0,
    status: 1,
    lines: fn.size(f.items),
    label: fn.concat(f.status, "-", fn.toString_(f.total)),
  }));
  static readonly unset = Pipeline.from(Order).unset(["items", "notes"]);
  static readonly unsetDotted = Pipeline.from(Customer).unset("address.zip");
  static readonly replaceRoot = Pipeline.from(Customer)
    .match({ address: { $exists: true } })
    .replaceRoot((f) => fn.mergeObjects(f.address, { who: f.name }));
  static readonly replaceWith = Pipeline.from(Order).replaceWith((f) => ({ id: f._id, n: f.total }));
  static readonly unwind = Pipeline.from(Order).unwind("$items");
  static readonly unwindOptions = Pipeline.from(Order).unwind({
    path: "$items",
    includeArrayIndex: "position",
    preserveNullAndEmptyArrays: true,
  });

  /* grouping */
  static readonly group = Pipeline.from(Order).group((f) => ({
    _id: f.status,
    revenue: fn.sum(f.total),
    orders: fn.count(),
    avg: fn.avg(f.total),
    first: fn.first(f.placedAt),
    last: fn.last(f.notes),
    min: fn.min(f.discount),
    max: fn.max(f.total),
    customers: fn.addToSet(f.customer),
    notes: fn.push(f.notes),
    sd: fn.stdDevPop(f.total),
    sds: fn.stdDevSamp(f.total),
    best: fn.top({ output: f.total, sortBy: [[f.total, -1]] }),
    worst: fn.bottom({ output: [f._id, f.total], sortBy: [[f.total, -1]] }),
    top2: fn.topN({ output: f.total, sortBy: [[f.placedAt, 1]], n: 2 }),
    bottom2: fn.bottomN({ output: f.total, sortBy: [[f.placedAt, 1]], n: 2 }),
    first2: fn.firstN({ input: f.total, n: 2 }),
    last2: fn.lastN({ input: f.notes, n: 2 }),
    max2: fn.maxN({ input: f.discount, n: 2 }),
    min2: fn.minN({ input: f.total, n: 2 }),
    median: fn.median({ input: f.total }),
    p: fn.percentile({ input: f.total, p: [0.5, 0.9] }),
    allItems: fn.concatArrays(f.items),
    itemSet: fn.setUnion(f.items),
    points: fn.sum(f.points),
  }));
  static readonly groupComposite = Pipeline.from(Order).group((f) => ({
    _id: { status: f.status, year: fn.year(f.placedAt), note: f.notes },
    n: fn.count(),
  }));
  static readonly groupMerge = Pipeline.from(Customer).group((f) => ({
    _id: f.tier,
    address: fn.mergeObjects(f.address),
  }));
  static readonly groupNull = Pipeline.from(Order).group((f) => ({ _id: null, total: fn.sum(f.total) }));
  static readonly bucket = Pipeline.from(Order).bucket({
    groupBy: (f) => f.total,
    boundaries: [0, 20, 100],
    default: "other",
    output: (f) => ({ n: fn.count(), totals: fn.push(f.total) }),
  });
  static readonly bucketCount = Pipeline.from(Order).bucket({ groupBy: (f) => f.total, boundaries: [0, 20, 100] });
  static readonly bucketAuto = Pipeline.from(Order).bucketAuto({ groupBy: (f) => f.total, buckets: 2 });
  static readonly sortByCount = Pipeline.from(Order).sortByCount((f) => f.status);
  static readonly window = Pipeline.from(Order).setWindowFields({
    partitionBy: (f) => f.status,
    sortBy: { placedAt: 1 },
    output: (f) => ({
      rank: fn.rank(),
      dense: fn.denseRank(),
      position: fn.documentNumber(),
      previous: fn.shift({ output: f.total, by: -1 }),
      nextOr: fn.shift({ output: f.total, by: 1, default: 0 }),
      running: withWindow(fn.sum(f.total), { documents: ["unbounded", "current"] }),
      all: withWindow(fn.push(f.total), { documents: ["unbounded", "unbounded"] }),
      avgAll: fn.avg(f.total),
      ema: fn.expMovingAvg({ input: f.total, N: 2 }),
      slope: withWindow(fn.derivative({ input: f.total, unit: "hour" }), {
        range: ["unbounded", "current"],
        unit: "hour",
      }),
      area: withWindow(fn.integral({ input: f.total, unit: "hour" }), {
        range: ["unbounded", "current"],
        unit: "hour",
      }),
      cov: fn.covariancePop(f.total, f.total),
      covs: fn.covarianceSamp(f.total, f.total),
      carried: fn.locf(f.discount),
      interpolated: fn.linearFill(f.discount),
      scaled: withWindow(fn.minMaxScaler({ input: f.total }), { documents: ["unbounded", "unbounded"] }),
    }),
  });
  static readonly windowUnsorted = Pipeline.from(Order).setWindowFields({
    partitionBy: (f) => f.status,
    output: (f) => ({ total: fn.sum(f.total), n: fn.count(), items: fn.addToSet(f.status) }),
  });
  static readonly densify = Pipeline.from(Reading).densify({
    field: "hour",
    partitionByFields: ["sensor"],
    range: { step: 1, bounds: "partition" },
  });
  static readonly fill = Pipeline.from(Reading).fill({
    partitionByFields: ["sensor"],
    sortBy: { hour: 1 },
    output: { value: { method: "linear" } },
  });
  static readonly fillValue = Pipeline.from(Reading).fill({ output: { value: { value: () => 0 } } });

  /* joins */
  static readonly lookup = Pipeline.from(Order)
    .lookup({ from: Customer, localField: "customer", foreignField: "_id", as: "buyer" })
    .unwind("$buyer");
  static readonly lookupPipeline = Pipeline.from(Customer).lookup({
    from: Order,
    as: "orders",
    let: (f) => ({ cid: f._id }),
    pipeline: (p, v) => p.match((o) => fn.eq(o.customer, v.cid)).project({ total: 1, status: 1 }),
  });
  static readonly lookupConcise = Pipeline.from(Customer).lookup({
    from: Order,
    localField: "_id",
    foreignField: "customer",
    as: "paid",
    pipeline: (p) => p.match({ status: "paid" }).count("n"),
  });
  static readonly lookupDocuments = Pipeline.from(Customer).lookup({
    as: "extra",
    pipeline: (p) => p.documents([{ k: 1 }, { k: 2 }]),
  });
  static readonly lookupDotted = Pipeline.from(Customer).lookup({
    from: Order,
    localField: "_id",
    foreignField: "customer",
    as: "address.orders",
  });
  static readonly graphLookup = Pipeline.from(Employee).graphLookup({
    from: Employee,
    startWith: (f) => f.manager,
    connectFromField: "manager",
    connectToField: "_id",
    as: "chain",
    depthField: "depth",
  });
  static readonly unionWith = Pipeline.from(Order).project({ total: 1 }).unionWith(Customer);
  static readonly unionWithPipeline = Pipeline.from(Order)
    .project({ total: 1 })
    .unionWith({ coll: Customer, pipeline: (p) => p.project({ name: 1 }) });
  static readonly unionWithDocuments = Pipeline.from(Order)
    .project({ total: 1 })
    .unionWith({ pipeline: (p) => p.documents([{ total: 0, synthetic: true }]) });
  static readonly facet = Pipeline.from(Order).facet({
    byStatus: (b) => b.sortByCount((f) => f.status),
    top: (b) => b.sort({ total: -1 }).limit(1).project({ total: 1 }),
  });

  /* first-stage-only */
  static readonly geoNear = Pipeline.from(Place).geoNear({
    near: { type: "Point", coordinates: [10.7, 59.9] },
    distanceField: "distance",
    includeLocs: "where",
    spherical: true,
  });
  static readonly documents = Pipeline.database().documents([
    { a: 1, b: "x" },
    { a: 2, b: "y" },
  ]);
  static readonly collStats = Pipeline.from(Order).collStats({ count: {}, storageStats: {} });
  static readonly indexStats = Pipeline.from(Order).indexStats();
  static readonly planCacheStats = Pipeline.from(Order).planCacheStats();
  static readonly listLocalSessions = Pipeline.database().listLocalSessions({ allUsers: true });
  static readonly currentOp = Pipeline.admin().currentOp({ idleConnections: false }).limit(5);
  static readonly queryStats = Pipeline.admin().queryStats();
  static readonly listClusterCatalog = Pipeline.database().listClusterCatalog();
  static readonly querySettings = Pipeline.admin().querySettings();

  /* terminal */
  static readonly out = Pipeline.from(Order)
    .group((f) => ({ _id: f.status, revenue: fn.sum(f.total), orders: fn.count() }))
    .out(StatusTotal);
  static readonly merge = Pipeline.from(Order)
    .group((f) => ({ _id: f.status, revenue: fn.sum(f.total), orders: fn.count() }))
    .merge({
      into: StatusTotal,
      on: "_id",
      whenMatched: (p, v) => p.set((f) => ({ revenue: fn.add(f.revenue, v.new.revenue) })),
      whenNotMatched: "insert",
    });
}
