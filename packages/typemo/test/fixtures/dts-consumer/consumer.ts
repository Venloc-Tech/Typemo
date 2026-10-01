/*
 * A consumer of `@venloc/typemo` written as a user writes it (imports from the package name only). The guard
 * test/guards/dts-consumer.test.ts compiles it through the BUILT declarations (two bugs lived only in the
 * emitted `.d.ts` — TS2589 on `$match`/`$group` and lost filter types — and the source-based type tests never saw
 * them). Type-only: never executed.
 */
import {
  Discriminator,
  type DiscriminatorValue,
  Entity,
  fn,
  type Lean,
  type Model,
  type OperationHookContext,
  Pipeline,
  PolicyContext,
  Pre,
  Prop,
  type Ref,
  Schema,
  Tenant,
  type TenantField,
  type TypemoClient,
  Types,
} from "@venloc/typemo";

/** A region: the target of `Account.region`. */
@Schema({ collection: "c_regions" })
export class Region extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}

/** A tenant-scoped account with a tag array, a reference and a `query.find` hook. */
@Schema({ collection: "c_accounts", tenant: true })
export class Account extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String, { required: true }) key!: string;
  @Prop(() => Number, { required: true }) n!: number;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => Types.ObjectId, { ref: () => Region }) region?: Ref<Region>;

  @Pre("query.find")
  audit(this: OperationHookContext<Account>): void {
    void this.filter;
  }
}

/** The base of the `Circle` discriminator. */
@Schema({ collection: "c_shapes" })
export class Shape extends Entity {
  @Prop(() => String) label?: string;
}

/** A `Shape` discriminator with a required radius. */
@Discriminator("circle")
export class Circle extends Shape {
  declare readonly __t: DiscriminatorValue<"circle">;
  @Prop(() => Number, { required: true }) radius!: number;
}

/**
 * Exercises filters, updates, populate, aggregation, discriminators, change streams and keyset paging
 * through the emitted declarations.
 *
 * @param client - a client (never connected: the code is only type-checked)
 * @returns values whose types the guard test inspects
 */
export const usage = async (client: TypemoClient) => {
  const Accounts: Model<Account> = client.connection.model(Account);
  const Circles = client.connection.model(Circle);
  /* Filters and updates (once failed with "'key' does not exist in type Filter<…>"). */
  await Accounts.updateOne({ key: "k" }, { $inc: { n: 5 } });
  await Accounts.find({ tags: { $in: ["a", "b"] }, n: { $gte: 1 } })
    .sort({ key: 1 })
    .lean();
  const created = await PolicyContext.run({ tenant: "t" }, () => Accounts.create({ key: "k", n: 1, tags: [] }));
  const tenant: string = created.tenantId;
  const populated = await Accounts.findOne({ key: "k" }).populate("region").orFail().lean();
  const regionName: string | undefined = populated.region?.name;
  /* Aggregations (once failed with TS2589 on $match / $group through the .d.ts). */
  const rows = await Accounts.aggregate((p) =>
    p.match({ key: "x" }).group((f) => ({ _id: f.key, total: fn.sum(f.n) })),
  );
  const first = rows[0];
  const total: number | undefined = first?.total;
  const grouped = Pipeline.from(Account).group((f) => ({ _id: f.key }));
  const circle: Lean<Circle> = await Circles.findOne({ radius: { $gt: 1 } })
    .orFail()
    .lean();
  const key: "circle" = circle.__t;
  const stream = await Accounts.watch((p) => p.match({ operationType: "insert" }), { fullDocument: "updateLookup" });
  await stream.close();
  const page = await Accounts.keysetPage({ sort: [["key", 1]], limit: 10, lean: true });
  return { tenant, regionName, total, grouped, key, page };
};
