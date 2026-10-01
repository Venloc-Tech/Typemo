/*
 * Type tests of the pipeline builder: the document type after every stage, where a stage may be used (mode/state
 * rules), and the fixes of the old wrapper's limitations. Every `@ts-expect-error` says what must fail.
 */
import type { AssertEqual, Expect } from "@venloc/typemo-test-kit";
import type { ChangeStreamDocument, ObjectId } from "mongodb";
import {
  fn,
  Pipeline,
  type PipelineDoc,
  type Ref,
  type RowOf,
  type SessionRow,
  Vars,
  withWindow,
} from "../../../src/index.ts";
import {
  Customer,
  Employee,
  type LineItem,
  Order,
  Place,
  Reading,
  StatusTotal,
} from "../../fixtures/aggregate-entities.ts";

type Row<B> = RowOf<B>;
type OrderDoc = PipelineDoc<Order>;
type CustomerDoc = PipelineDoc<Customer>;

// ---- the root document --------------------------------------------------------------------------------
export type Root = [
  Expect<AssertEqual<Row<ReturnType<typeof Pipeline.from<typeof Order>>>, OrderDoc>>,
  Expect<AssertEqual<OrderDoc["total"], number>>,
  Expect<AssertEqual<OrderDoc["customer"], Ref<Customer>>>,
];

// ---- reshaping ------------------------------------------------------------------------------------------
const added = Pipeline.from(Order).addFields((f) => ({
  net: fn.multiply(f.total, 2),
  "stats.year": fn.year(f.placedAt),
  notes: fn.remove(),
  first: fn.arrayElemAt(f.items, 0),
}));
export type Added = [
  Expect<AssertEqual<Row<typeof added>["net"], number>>,
  Expect<AssertEqual<Row<typeof added>["stats"], { year: number }>>,
  Expect<AssertEqual<"notes" extends keyof Row<typeof added> ? true : false, false>>, // $$REMOVE drops the key
  Expect<AssertEqual<Row<typeof added>["first"], PipelineDoc<LineItem> | undefined>>, // optional: may be missing
];

const projected = Pipeline.from(Customer).project({ name: 1, "address.city": 1 });
export type Projected = Expect<
  AssertEqual<Row<typeof projected>, { name: string; address?: { city: string }; _id: ObjectId }>
>;
const excluded = Pipeline.from(Customer).project({ email: 0, address: 0 });
export type Excluded = Expect<AssertEqual<keyof Row<typeof excluded>, "_id" | "name" | "tier" | "since">>;

// @ts-expect-error — $project cannot keep some fields and exclude others
Pipeline.from(Customer).project({ name: 1, email: 0 });
// @ts-expect-error — "nmae" is not a path of Customer
Pipeline.from(Customer).project({ nmae: 1 });
// @ts-expect-error — a bare number other than 0/1 in $project needs fn.literal
Pipeline.from(Customer).project(() => ({ n: 5 }));
// @ts-expect-error — a dotted key cannot write into an array (items is an array of subdocuments)
Pipeline.from(Order).addFields(() => ({ "items.x": 1 }));
// @ts-expect-error — an accumulator is not a value of $addFields
Pipeline.from(Order).addFields((f) => ({ x: fn.push(f.total) }));
// @ts-expect-error — an accumulator is not a value of $set
Pipeline.from(Order).set((f) => ({ x: fn.push(f.total) }));
// @ts-expect-error — an accumulator is not a value of $project (the server: "Unknown expression $push")
Pipeline.from(Order).project((f) => ({ _id: 0, all: fn.push(f.total) }));
// @ts-expect-error — a window function is not a value of $project
Pipeline.from(Order).project(() => ({ r: fn.rank() }));
// @ts-expect-error — an accumulator is not a $match expression
Pipeline.from(Order).match((f) => fn.push(f.total));
/* An operator that is both an expression and an accumulator ($sum of one argument) stays valid in $project. */
const summed = Pipeline.from(Order).project((f) => ({ all: fn.sum(f.total), status: 1 }));
export type Summed = Expect<AssertEqual<Row<typeof summed>["all"], number>>;

// ---- unwind, unset, replaceRoot ------------------------------------------------------------------------------
const unwound = Pipeline.from(Order).unwind({
  path: "$items",
  includeArrayIndex: "i",
  preserveNullAndEmptyArrays: true,
});
export type Unwound = [
  Expect<AssertEqual<Row<typeof unwound>["i"], bigint | null>>, // includeArrayIndex is an int64
  Expect<AssertEqual<Row<typeof unwound>["items"], PipelineDoc<LineItem> | null | undefined>>,
];
// @ts-expect-error — only an array field can be unwound
Pipeline.from(Order).unwind("$status");
const unset = Pipeline.from(Customer).unset("address.zip");
export type Unset = Expect<AssertEqual<Row<typeof unset>["address"], { city: string } | undefined>>;
const replaced = Pipeline.from(Order).replaceWith((f) => ({ id: f._id, n: f.total }));
export type Replaced = Expect<AssertEqual<Row<typeof replaced>, { id: ObjectId; n: number }>>;

// ---- $group and friends (kinds) ---------------------------------------------------------------------------
const grouped = Pipeline.from(Order).group((f) => ({
  _id: { status: f.status, note: f.notes },
  revenue: fn.sum(f.total),
  best: fn.top({ output: f.total, sortBy: [[f.total, -1]] }),
  notes: fn.push(f.notes),
  last: fn.last(f.discount),
}));
export type Grouped = [
  Expect<AssertEqual<Row<typeof grouped>["_id"], { status: "paid" | "open"; note?: string }>>, // a missing key is left out
  Expect<AssertEqual<Row<typeof grouped>["revenue"], number>>,
  Expect<AssertEqual<Row<typeof grouped>["notes"], string[]>>, // missing values are skipped by $push
  Expect<AssertEqual<Row<typeof grouped>["last"], number | null>>,
];
// @ts-expect-error — every $group field but _id needs an accumulator
Pipeline.from(Order).group((f) => ({ _id: null, x: fn.add(f.total, 1) }));
// @ts-expect-error — $top.sortBy takes field references ([f.field, order]), not computed expressions
Pipeline.from(Order).group((f) => ({ _id: null, x: fn.top({ output: f.total, sortBy: [[fn.add(f.total, 1), -1]] }) }));

const buckets = Pipeline.from(Order).bucket({ groupBy: (f) => f.total, boundaries: [0, 20], default: "other" });
export type Buckets = Expect<AssertEqual<Row<typeof buckets>, { _id: number | "other"; count: number }>>;
// @ts-expect-error — boundaries have the type of groupBy (numbers here)
Pipeline.from(Order).bucket({ groupBy: (f) => f.total, boundaries: ["a", "b"] });

// ---- $setWindowFields ------------------------------------------------------------------------------------------
const windowed = Pipeline.from(Order).setWindowFields({
  sortBy: { placedAt: 1 },
  output: (f) => ({
    rank: fn.rank(),
    running: withWindow(fn.sum(f.total), { documents: ["unbounded", "current"] }),
    slope: withWindow(fn.derivative({ input: f.total, unit: "hour" }), {
      range: ["unbounded", "current"],
      unit: "hour",
    }),
  }),
});
export type Windowed = Expect<AssertEqual<Row<typeof windowed>["rank"], number>>;
// @ts-expect-error — $rank needs a sortBy with exactly one field (server rule)
Pipeline.from(Order).setWindowFields({ sortBy: { placedAt: 1, total: 1 }, output: () => ({ r: fn.rank() }) });
// @ts-expect-error — $denseRank needs a sortBy with exactly one field
Pipeline.from(Order).setWindowFields({ sortBy: { placedAt: 1, total: -1 }, output: () => ({ r: fn.denseRank() }) });
// @ts-expect-error — $documentNumber needs a sortBy with exactly one field
Pipeline.from(Order).setWindowFields({ sortBy: { placedAt: 1, total: 1 }, output: () => ({ n: fn.documentNumber() }) });
Pipeline.from(Order).setWindowFields({
  sortBy: { placedAt: 1, total: 1 },
  // @ts-expect-error — $linearFill needs a sortBy with exactly one field
  output: (f) => ({ v: fn.linearFill(f.total) }),
});
// @ts-expect-error — a typo next to a valid sortBy key is still a typo ("placed")
Pipeline.from(Order).setWindowFields({ sortBy: { placedAt: 1, placed: 1 }, output: () => ({ n: fn.count() }) });
/* One sortBy field: all four compile; other ordered functions ($shift) accept several fields. */
const ranked = Pipeline.from(Order).setWindowFields({
  sortBy: { placedAt: 1 },
  output: (f) => ({ r: fn.rank(), d: fn.denseRank(), n: fn.documentNumber(), v: fn.linearFill(f.total) }),
});
export type Ranked = [
  Expect<AssertEqual<Row<typeof ranked>["r"], number>>,
  Expect<AssertEqual<Row<typeof ranked>["n"], number>>,
];
const shifted = Pipeline.from(Order).setWindowFields({
  sortBy: { placedAt: 1, total: -1 },
  output: (f) => ({ prev: fn.shift({ output: f.total, by: -1 }) }),
});
export type Shifted = Expect<AssertEqual<Row<typeof shifted>["prev"], number | null>>;
// @ts-expect-error — $rank needs sortBy
Pipeline.from(Order).setWindowFields({ output: () => ({ r: fn.rank() }) });
// @ts-expect-error — a bounded window needs sortBy
Pipeline.from(Order).setWindowFields({ output: (f) => ({ s: withWindow(fn.sum(f.total), { documents: [-1, 0] }) }) });
Pipeline.from(Order).setWindowFields({
  sortBy: { placedAt: 1 },
  // @ts-expect-error — $derivative needs an explicit window (withWindow)
  output: (f) => ({ d: fn.derivative({ input: f.total }) }),
});
// @ts-expect-error — an expression is not a window function
Pipeline.from(Order).setWindowFields({ output: (f) => ({ x: fn.add(f.total, 1) }) });
// @ts-expect-error — the window sortBy names paths of the document ("placed" is a typo)
Pipeline.from(Order).setWindowFields({ sortBy: { placed: 1 }, output: () => ({ n: fn.count() }) });

// ---- joins -------------------------------------------------------------------------------------------------------
const looked = Pipeline.from(Order).lookup({
  from: Customer,
  localField: "customer",
  foreignField: "_id",
  as: "buyer",
});
export type Looked = Expect<AssertEqual<Row<typeof looked>["buyer"], CustomerDoc[]>>;
// @ts-expect-error — foreignField is a path of the joined entity ("nam" is not)
Pipeline.from(Order).lookup({ from: Customer, localField: "customer", foreignField: "nam", as: "buyer" });

const withLet = Pipeline.from(Customer).lookup({
  from: Order,
  as: "orders",
  let: (f) => ({ cid: f._id }),
  pipeline: (p, v) => p.match((o) => fn.eq(o.customer, v.cid)).project({ total: 1 }),
});
export type WithLet = Expect<AssertEqual<Row<typeof withLet>["orders"], { total: number; _id: ObjectId }[]>>;

const graph = Pipeline.from(Employee).graphLookup({
  from: Employee,
  startWith: (f) => f.manager,
  connectFromField: "manager",
  connectToField: "_id",
  as: "chain",
  depthField: "depth",
});
export type Graph = Expect<AssertEqual<Row<typeof graph>["chain"][number]["depth"], bigint>>;

// unionWith gives a union of document types (the wrapper: T & Record<string, unknown>)
const union = Pipeline.from(Order).project({ total: 1 }).unionWith(Customer);
export type Union = Expect<AssertEqual<Row<typeof union>, { total: number; _id: ObjectId } | CustomerDoc>>;

const faceted = Pipeline.from(Order).facet({
  n: (b) => b.count("n"),
  top: (b) => b.sort({ total: -1 }).limit(1),
});
export type Faceted = Expect<AssertEqual<Row<typeof faceted>, { n: { n: number }[]; top: OrderDoc[] }>>;
// @ts-expect-error — a $facet branch must have a stage
Pipeline.from(Order).facet({ empty: (b) => b });
// @ts-expect-error — $facet cannot be nested
Pipeline.from(Order).facet({ inner: (b) => b.facet({ x: (c) => c.count("n") }) });

// ---- first-stage-only ---------------------------------------------------------------------------------------------
const near = Pipeline.from(Place).geoNear({ near: [10, 59], distanceField: "d", includeLocs: "loc" });
export type Near = Expect<AssertEqual<Row<typeof near>["d"], number>>;
// @ts-expect-error — $geoNear must be the first stage
Pipeline.from(Place)
  .limit(1)
  .geoNear({ near: [10, 59], distanceField: "d" });
// @ts-expect-error — $documents starts a database aggregation, not a collection one
Pipeline.from(Order).documents([{ a: 1 }]);
// @ts-expect-error — $currentOp runs on the admin database
Pipeline.database().currentOp();
// @ts-expect-error — $listSessions runs only on config.system.sessions (Pipeline.sessions()), not on a model's collection
Pipeline.from(Order).listSessions({ allUsers: true });
// @ts-expect-error — nor in a database aggregation
Pipeline.database().listSessions();
// @ts-expect-error — the sessions aggregation starts with $listSessions only
Pipeline.sessions().documents([{ a: 1 }]);
const sessions = Pipeline.sessions()
  .listSessions({ allUsers: true })
  .match({ lastUse: { $exists: true } });
export type Sessions = Expect<AssertEqual<Row<typeof sessions>, SessionRow>>;
sessions.plan();
// @ts-expect-error — the sessions aggregation only reads: no $out
sessions.out("x");
const docs = Pipeline.database().documents([{ a: 1 }, { a: 2 }]);
export type Docs = Expect<AssertEqual<Row<typeof docs>, { a: 1 } | { a: 2 }>>;
// @ts-expect-error — $search path names a field of the collection
Pipeline.from(Order).search({ text: { query: "x", path: "stauts" } });
const events = Pipeline.from(Order).changeStream();
export type Events = Expect<AssertEqual<Row<typeof events>, ChangeStreamDocument<OrderDoc>>>;

// ---- terminal stages and modes -------------------------------------------------------------------------------------
Pipeline.from(Order)
  .group((f) => ({ _id: f.status, revenue: fn.sum(f.total), orders: fn.count() }))
  .out(StatusTotal);
Pipeline.from(Order)
  .group((f) => ({ _id: f.status }))
  // @ts-expect-error — the rows do not fit StatusTotal (revenue/orders are missing): materialized row check
  .out(StatusTotal);
// @ts-expect-error — nothing runs after $out: a terminal pipeline has no stage methods
Pipeline.from(Order).limit(1).out("x").limit(1);
// `$out` takes a name, or `{ db, coll }` with both fields (the server refuses `{ coll }` alone)
Pipeline.from(Order).limit(1).out("x");
Pipeline.from(Order).limit(1).out({ db: "app", coll: "x" });
Pipeline.from(Order)
  .limit(1)
  .out({ db: "app", coll: "x", timeseries: { timeField: "at" } });
// @ts-expect-error — `db` is required in the object form
Pipeline.from(Order).limit(1).out({ coll: "x" });
// @ts-expect-error — `coll` is required in the object form
Pipeline.from(Order).limit(1).out({ db: "app" });
// @ts-expect-error — an empty pipeline has no plan
Pipeline.from(Order).plan();
// @ts-expect-error — a view pipeline cannot $out
Pipeline.view(StatusTotal, { on: Order, pipeline: (p) => p.limit(1).out("x") });
// @ts-expect-error — the view rows must fit the view class
Pipeline.view(StatusTotal, { on: Order, pipeline: (p) => p.limit(1) });
// @ts-expect-error — an update pipeline has no $group
Pipeline.update(Order).group(() => ({ _id: null }));
// @ts-expect-error — a change stream pipeline has no $lookup
Pipeline.watch(Order).lookup({ from: Customer, localField: "customer", foreignField: "_id", as: "c" });
Pipeline.watch(Order).match({ operationType: "insert" }).changeStreamSplitLargeEvent();

// ---- $densify / $fill ---------------------------------------------------------------------------------------------
Pipeline.from(Reading).densify({ field: "hour", range: { step: 1, bounds: "full" } });
// @ts-expect-error — a numeric field takes no date unit
Pipeline.from(Reading).densify({ field: "hour", range: { step: 1, unit: "day", bounds: "full" } });
// @ts-expect-error — $fill by method needs sortBy
Pipeline.from(Reading).fill({ output: { value: { method: "linear" } } });

// ---- $redact takes only the three verdicts --------------------------------------------------------------------------
Pipeline.from(Order).redact(() => Vars.KEEP);
// @ts-expect-error — a string is not a verdict (would be read as a literal)
Pipeline.from(Order).redact(() => "$$KEEP");
