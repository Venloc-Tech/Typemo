# Aggregation: typed pipelines

Read this before writing `Model.aggregate`, a `$lookup`/`$group`/window pipeline, `$out`/`$merge`, a database-level aggregation, or a view. Typemo builds the pipeline with **methods**, never raw stage objects; every stage returns a new builder with a new **row type**, so after `group` the row is what you grouped, not the entity. Typos in field names and non-accumulators in `group` are compile errors.

## Minimal working example

```ts
import { Entity, fn, Prop, Schema, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => String, { required: true }) status!: string;
  @Prop(() => Number, { required: true }) total!: number;
  @Prop(() => Date, { required: true }) placedAt!: Date;
}

declare const client: TypemoClient;
const Orders = client.connection.model(Order);

const rows = await Orders.aggregate((p) =>
  p
    .match({ status: "paid" })
    .group((f) => ({ _id: f.customer, orders: fn.count(), spent: fn.sum(f.total) }))
    .sort({ spent: "descending" }), // "ascending" | "descending" | 1 | -1
);
console.log(rows[0]?.spent); // number; rows: { _id: string; orders: number; spent: number }[]
```

Facts:

- `aggregate` is lazy (runs on `await`), immutable (`.plain()`, `.session()`, `.policy()`, `.comment()`, `.timeoutMS()`, `.batchSize()` each return a new query) and runs **once per query object**: a second `await` returns the same rows. `.exec({ force: true })` runs again.
- Rows are NOT hydrated: values are driver values (`_id` is an `ObjectId`, `int64` a `bigint`). For JSON use `.plain()` (ids, `bigint`, `Decimal128`, `UUID` become strings; dates stay dates).
- Rows start WITHOUT `Hidden` fields (removed by the first stage). To keep one build the plan with `Pipeline.from(Order, { include: ["internalNote"] })` (a callback has no options).
- Tenant, soft delete and other policies apply to the first collection; inside a `client.transaction` the query uses the transaction session.
- Large results: `for await (const row of query.batchSize(500).cursor())`. Diagnose: `await query.explain("executionStats")`.

## Reusable plans: Pipeline.from(...).plan()

```ts
import { Entity, fn, Pipeline, Prop, Schema, type RowOf, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => String, { required: true }) status!: string;
  @Prop(() => Number, { required: true }) total!: number;
}

export const spending = Pipeline.from(Order)
  .match({ status: "paid" })
  .group((f) => ({ _id: f.customer, spent: fn.sum(f.total) }))
  .plan(); // needs at least one stage; frozen plan

declare const client: TypemoClient;
const Orders = client.connection.model(Order);
const rows = await Orders.aggregate(spending).plain();
const builder = Pipeline.from(Order).match({ status: "paid" });
type Row = RowOf<typeof builder>; // the row type of a builder
declare const sample: Row;
console.log(rows.length, sample.status);
```

A plan is bound to its collection: giving a plan of another collection to `aggregate` throws `ConfigurationError: Order.aggregate: the plan reads "other", not this model's collection "orders"` before any request. A non-callback, non-plan argument: `QueryError: aggregate: a pipeline callback or an aggregation plan`.

## Stages: the common ones

```ts
import { Entity, fn, Prop, Schema, withWindow, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "customers" })
class Customer extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { required: true }) country!: string;
}
@Schema({ collection: "archived_orders" })
class ArchivedOrder extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => Number, { required: true }) total!: number;
}
@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => String, { required: true }) status!: string;
  @Prop(() => Number, { required: true }) total!: number;
  @Prop(() => Date, { required: true }) placedAt!: Date;
}

declare const client: TypemoClient;
const Orders = client.connection.model(Order);
client.connection.model(Customer);
client.connection.model(ArchivedOrder);

// group by date part; `_id: null` = one row for everything
const byMonth = await Orders.aggregate((p) =>
  p
    .group((f) => ({ _id: fn.dateToString({ date: f.placedAt, format: "%Y-%m" }), revenue: fn.sum(f.total) }))
    .sort({ _id: 1 }),
);

// lookup by field (as = array), then one object via unwind + project
const withCountry = await Orders.aggregate((p) =>
  p
    .lookup({ from: Customer, localField: "customer", foreignField: "name", as: "buyer" })
    .unwind("$buyer")
    .project((f) => ({ customer: 1, country: f.buyer.country, _id: 0 })),
);

// lookup with conditions: `let` + sub-pipeline (the second argument holds the variables)
const big = await Orders.aggregate((p) =>
  p.lookup({
    from: Customer,
    as: "same",
    let: (f) => ({ who: f.customer }),
    pipeline: (c, v) => c.match((x) => fn.eq(x.name, v.who)).project({ country: 1, _id: 0 }),
  }),
);

// unionWith another collection (plain or with its own pipeline)
const both = await Orders.aggregate((p) =>
  p.project({ customer: 1, total: 1, _id: 0 }).unionWith({
    coll: ArchivedOrder,
    pipeline: (a) => a.project({ customer: 1, total: 1, _id: 0 }),
  }),
);

// window: running total and rank per customer
const timeline = await Orders.aggregate((p) =>
  p.setWindowFields({
    partitionBy: (f) => f.customer,
    sortBy: { placedAt: 1 },
    output: (f) => ({
      running: withWindow(fn.sum(f.total), { documents: ["unbounded", "current"] }),
      rank: fn.rank(), // rank/denseRank/documentNumber need a sortBy with exactly ONE field
    }),
  }),
);
console.log(byMonth, withCountry, big, both, timeline);
```

Other stages in the same style: `addFields`, `unset`, `skip`, `limit`, `sample`, `replaceRoot`, `graphLookup`, `bucket`/`bucketAuto` (`groupBy: (f) => f.total, boundaries: [0, 50, 100]`), `count("n")`, `densify`, `fill`, `facet`, `search`/`vectorSearch` (Atlas only). `fn.sum(1)` counts like `fn.count()`; `fn.push`, `fn.avg`, `fn.min/max`, `fn.first/last`, `fn.top` are accumulators.

## Facet: summary and a page in one query

A `facet` row has one array per branch (not an array of result rows); an empty branch is `[]`, so read `report?.count[0]?.n ?? 0`. Branches cannot contain `out`, `merge` or `facet`.

```ts
import { Entity, Prop, Schema, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) status!: string;
  @Prop(() => Number, { required: true }) total!: number;
  @Prop(() => Date, { required: true }) placedAt!: Date;
}
declare const client: TypemoClient;
const Orders = client.connection.model(Order);

export const page = async (status: string, n: number) => {
  const [report] = await Orders.aggregate((p) =>
    p.match({ status }).facet({
      count: (b) => b.count("n"),
      rows: (b) => b.sort({ placedAt: "descending" }).skip((n - 1) * 20).limit(20),
    }),
  ).plain();
  return { total: report?.count[0]?.n ?? 0, rows: report?.rows ?? [] };
};
```

## Expressions: fn and f

Inside callbacks `f` is the typed current row (`f.address.city`; under an optional parent every field gets `| undefined`) and `fn.*` are the operators (`fn.add`, `fn.subtract`, `fn.multiply`, `fn.cond`, `fn.ifNull`, `fn.concat`, `fn.eq/gt/gte/lt/and/or`, `fn.map`, `fn.filter`, `fn.dateToString`, `fn.toUpper`, `fn.now`, `fn.remove`, ...).

```ts
import { Entity, fn, Prop, Schema, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "products" })
class Product extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) price!: number;
  @Prop(() => Number) discount?: number;
  @Prop(() => [String], { required: true }) tags!: string[];
}
declare const client: TypemoClient;
const Products = client.connection.model(Product);

const rows = await Products.aggregate((p) =>
  p
    // missing value is null in arithmetic: fn.subtract(f.price, f.discount) would be null; ifNull gives the default
    .addFields((f) => ({ final: fn.subtract(f.price, fn.ifNull(f.discount, 0)) }))
    .match((f) => fn.gt(f.final, 10)) // a condition is a callback returning an expression, never a raw $expr
    .project((f) => ({
      _id: 0,
      title: 1,
      tier: fn.cond(fn.gte(f.final, 30), "premium", "basic"),
      tags: fn.map({ input: f.tags, in: (tag) => fn.toUpper(tag) }),
    })),
);
console.log(rows);
```

A string starting with `$` in an expression is a literal string (`"$5 off"` becomes `{ $literal: "$5 off" }`); to reference a field use `f.x`. In `find`, the raw `$expr` object is rejected; write `$expr: (f) => fn.gt(f.price, 20)`.

## Writing results: out and merge into an EntityWithId target

`out`/`merge` end the pipeline and make the query a **write** (no rows; a second `await`/`exec()` throws `QueryError: aggregate: this operation was already executed; build a new one, or run it again deliberately with exec({ force: true }) (a write runs once per builder)`). The target class must fit the rows (the compiler compares them); a computed `_id` needs a target built with `EntityWithId(() => String)`.

```ts
import { Entity, EntityWithId, fn, Prop, Schema, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) status!: string;
  @Prop(() => Number, { required: true }) total!: number;
  @Prop(() => Date, { required: true }) placedAt!: Date;
}
@Schema({ collection: "monthly_revenue" })
class MonthlyRevenue extends EntityWithId(() => String) {
  @Prop(() => Number, { required: true }) revenue!: number;
}
declare const client: TypemoClient;
const Orders = client.connection.model(Order);
const Monthly = client.connection.model(MonthlyRevenue);

// replace the matching rows, keep the others
await Orders.aggregate((p) =>
  p
    .match({ status: "paid" })
    .group((f) => ({ _id: fn.dateToString({ date: f.placedAt, format: "%Y-%m" }), revenue: fn.sum(f.total) }))
    .merge({ into: MonthlyRevenue, whenMatched: "replace" }),
);
console.log(await Monthly.find().sort({ _id: 1 }).lean());
```

- A custom update rule: `whenMatched: (u, v) => u.set((f) => ({ revenue: fn.add(f.revenue, v.new.revenue) }))` (`v.new` is the incoming row), with `on: "_id"`.
- `out(Target)` replaces the WHOLE target collection (it can be a name string or `{ db, coll }`). Use it only for a collection you own; `merge` for incremental updates.
- Adding with `whenMatched` and running the job twice doubles the number: make such jobs idempotent (`"replace"`).
- `merge` with `on` other than `_id` needs a unique index on exactly those fields (`ConfigurationError ... needs a unique index on exactly these fields`).

## Views and materialized results

`TypedView` is a server-side view with a typed result class. `Materialized.define(connection, OwnerTotal, { from: Account, pipeline })` (target `EntityWithId(() => String)`, grouped by `_id`) stores a pipeline result in a real collection; call `await ownerTotals.refresh()` on a schedule and read `ownerTotals.model`. Details in file 11.

```ts
import { Entity, Prop, Schema, TypedView, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { required: true }) balance!: number;
  @Prop(() => Boolean, { required: true }) closed!: boolean;
}
@Schema({ collection: "open_accounts" })
class OpenAccount extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}

declare const client: TypemoClient;
const connection = client.connection;
connection.model(Account);

// the pipeline is checked against the OpenAccount fields (missing/extra fields do not compile)
const openAccounts = TypedView.define(connection, OpenAccount, {
  on: Account,
  pipeline: (p) => p.match({ closed: false }).project({ owner: 1, balance: 1 }),
});
await connection.init(); // creates the view (and collections, indexes)
console.log(await openAccounts.find({ owner: "alice" }));
```

## Database-level aggregations

No collection: `Pipeline.database()` (`documents`, `listLocalSessions`, ...), `Pipeline.admin()` (`currentOp`, runs on `admin`), `Pipeline.sessions()` (`listSessions`). Run with `client.aggregate(plan)` (the client's default database) or `connection.aggregate(plan)` (that connection's database). A collection plan to `client.aggregate`, or a database plan to `Model.aggregate`, throws `ConfigurationError` naming the right entry point. The rows can be read with `.cursor()` too.

```ts
import { Entity, Pipeline, Prop, Schema, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) email!: string;
}
declare const client: TypemoClient;
client.connection.model(Account);

// which of these emails already exist: a literal list joined with a collection
const rows = await client.aggregate(
  Pipeline.database()
    .documents([{ email: "ann@example.com" }, { email: "bob@example.com" }])
    .lookup({ from: Account, localField: "email", foreignField: "email", as: "found" })
    .plan(),
);
console.log(rows.filter((row) => row.found.length > 0).map((row) => row.email));

const ops = await client.aggregate(Pipeline.admin().currentOp({ idleConnections: false }).plan()).timeoutMS(5_000);
console.log(ops.length);
```

## Common mistakes

Bad (a typo in a field; the compiler suggests the nearest name):

```ts
// @errors: 2551
import { Entity, fn, Prop, Schema, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => Number, { required: true }) total!: number;
}
declare const client: TypemoClient;
const Orders = client.connection.model(Order);
await Orders.aggregate((p) => p.group((f) => ({ _id: f.custmer, spent: fn.sum(f.total) })));
```

`Did you mean 'customer'?`. Also after `group` the row has only the grouped fields: later stages cannot read `status` or `placedAt` any more.

Bad (a non-accumulator in `group`):

```ts
// @errors: 2741
import { Entity, fn, Prop, Schema, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => Number, { required: true }) total!: number;
}
declare const client: TypemoClient;
const Orders = client.connection.model(Order);
await Orders.aggregate((p) => p.group((f) => ({ _id: f.customer, doubled: fn.add(f.total, 1) })));
```

`$group field "doubled" needs an accumulator (fn.sum, fn.avg, fn.push, fn.first, fn.count, ...)`. Good: an accumulator in `group`, the formula in `addFields` before or after it. A `group` without `_id` also fails to compile (TS2741).

Bad: `setWindowFields` with `fn.rank()` and no `sortBy`, or a `sortBy` of two fields: compile error `$setWindowFields output "rank" needs a sortBy with exactly one field (rank, denseRank, documentNumber and linearFill: a server rule)`. Good: `sortBy: { total: -1 }`.

Bad: `Products.find({ $expr: { $gt: ["$price", 20] } })` (TS2353; at runtime `QueryError: filter: $expr is a callback (f) => fn.… (a raw $expr object is not typed)`). Good: `$expr: (f) => fn.gt(f.price, 20)`. `fn.gt(f.price, "20")` does not compile either.

- Bad: facet branch with `out`/`merge`/`facet` (compile error); reading a facet result as rows. Good: `const [report] = await ...; report?.count[0]?.n ?? 0`.
- Bad: filtering main documents by related fields via populate. Good: `lookup` in aggregation. Bad: `Pipeline.from(Order).plan()` with no stage (TS2684). Bad: `$out` into a collection whose data you keep. Good: `merge`.

## Self-check

- Every stage is a method; no raw `$`-objects, no raw `$expr`; `group` fields other than `_id` are accumulators.
- Rows that leave the server as JSON use `.plain()`; big results use `.cursor()`.
- Each query object is awaited once (re-run with `exec({ force: true })` only on purpose); writes (`out`/`merge`) are idempotent.
- A `Hidden` field needed in rows is requested with `Pipeline.from(Model, { include })`.
- Database-level plans run via `client.aggregate` / `connection.aggregate`, collection plans via the model.
