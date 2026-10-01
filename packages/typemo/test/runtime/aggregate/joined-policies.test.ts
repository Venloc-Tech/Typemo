/*
 * The policies of a joined collection come from the entity the stage names, not from the connection's model
 * registry: soft delete, tenant and Hidden apply to `lookup`, `unionWith` and `graphLookup` of an entity whose
 * model was never created on the connection — in `Model.aggregate` and in database-level plans
 * (`connection.aggregate` / `client.aggregate`). A collection named by a string still uses the registry.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  ConfigurationError,
  Entity,
  type Hidden,
  type Model,
  Pipeline,
  type PipelineSource,
  PolicyContext,
  Prop,
  Schema,
  Tenant,
  type TenantField,
} from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** Soft-deleted, with a hidden field; never registered as a model in these tests. */
@Schema({ collection: "jp_members", softDelete: true })
class Member extends Entity {
  @Prop(() => String, { required: true }) email!: string;
  @Prop(() => String, { hidden: true }) pin?: Hidden<string>;
  @Prop(() => Date, { nullable: true }) deletedAt?: Date | null;
}

/** Tenant-scoped; never registered as a model in these tests. */
@Schema({ collection: "jp_notes", tenant: true })
class Memo extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String, { required: true }) email!: string;
  @Prop(() => String, { required: true }) text!: string;
}

/** The model the aggregations run on (no policies of its own). */
@Schema({ collection: "jp_orders" })
class Purchase extends Entity {
  @Prop(() => String, { required: true }) email!: string;
}

const t = ModelLifecycle.useTypemo("joined_policies");
let Purchases: Model<Purchase>;

beforeEach(async () => {
  Purchases = t.connection.model(Purchase);
  await t.mongo.db.collection("jp_orders").insertMany([{ email: "ann@x.io" }, { email: "bob@x.io" }]);
  await t.mongo.db.collection("jp_members").insertMany([
    { email: "ann@x.io", pin: "1111", deletedAt: null },
    { email: "bob@x.io", pin: "2222", deletedAt: new Date() },
  ]);
  await t.mongo.db.collection("jp_notes").insertMany([
    { tenantId: "ta", email: "ann@x.io", text: "a" },
    { tenantId: "tb", email: "ann@x.io", text: "b" },
  ]);
});

/**
 * The number of joined documents per email.
 * @param rows The rows with an `email` and a joined array `found`.
 * @returns `email → count`.
 */
const counts = (rows: readonly { readonly email: string; readonly found: readonly unknown[] }[]) =>
  Object.fromEntries(rows.map((row) => [row.email, row.found.length]));

describe("Model.aggregate: the joined entity's policies without its model", () => {
  test("lookup leaves soft-deleted documents and Hidden fields out", async () => {
    expect(t.connection.models.some((model) => model.collectionName === "jp_members")).toBe(false);
    const rows = await Purchases.aggregate((p) =>
      p
        .lookup({ from: Member, localField: "email", foreignField: "email", as: "found" })
        .project({ _id: 0, email: 1, found: 1 }),
    );
    expect(counts(rows)).toEqual({ "ann@x.io": 1, "bob@x.io": 0 });
    const ann = rows.find((row) => row.email === "ann@x.io");
    expect(Object.keys((ann?.found[0] ?? {}) as object)).not.toContain("pin");
  });

  test("unionWith and graphLookup leave soft-deleted documents out", async () => {
    const union = await Purchases.aggregate((p) => p.project({ _id: 0, email: 1 }).unionWith(Member));
    expect(union.map((row) => row.email).sort()).toEqual(["ann@x.io", "ann@x.io", "bob@x.io"]);
    const graph = await Purchases.aggregate((p) =>
      p
        .graphLookup({
          from: Member,
          startWith: (f) => f.email,
          connectFromField: "email",
          connectToField: "email",
          as: "found",
        })
        .project({ _id: 0, email: 1, found: 1 }),
    );
    expect(counts(graph)).toEqual({ "ann@x.io": 1, "bob@x.io": 0 });
  });

  test("lookup and unionWith of a tenant-scoped entity read the operation's tenant only", async () => {
    const rows = await PolicyContext.run({ tenant: "ta" }, () =>
      Purchases.aggregate((p) =>
        p
          .lookup({ from: Memo, localField: "email", foreignField: "email", as: "found" })
          .project({ _id: 0, email: 1, found: 1 }),
      ),
    );
    expect(counts(rows)).toEqual({ "ann@x.io": 1, "bob@x.io": 0 });
    const union = await PolicyContext.run({ tenant: "ta" }, () =>
      Purchases.aggregate((p) => p.match({ email: "none" }).unionWith(Memo)),
    );
    expect(union.map((row) => (row as { text?: string }).text)).toEqual(["a"]);
  });

  test("a join of a tenant-scoped entity without a tenant is refused before anything is sent", async () => {
    t.commands.clear();
    await expect(
      Purchases.aggregate((p) =>
        p.lookup({ from: Memo, localField: "email", foreignField: "email", as: "found" }),
      ).exec(),
    ).rejects.toEqual(expect.objectContaining({ name: "StrictModeError", reason: "tenant" }));
    await expect(Purchases.aggregate((p) => p.unionWith(Memo)).exec()).rejects.toEqual(
      expect.objectContaining({ name: "StrictModeError", reason: "tenant" }),
    );
    expect(t.commands.byName("aggregate")).toHaveLength(0);
  });

  test("a typed source without an entity has no policies without a model", async () => {
    const members: PipelineSource<{ _id: unknown; email: string }> = {
      pipelineTarget: { kind: "collection", collection: "jp_members", entity: undefined, discriminator: undefined },
    };
    const rows = await Purchases.aggregate((p) =>
      p.lookup({ from: members, localField: "email", foreignField: "email", as: "found" }),
    );
    expect(rows.every((row) => (row.found as unknown[]).length === 1)).toBe(true);
  });
});

describe("other stages naming an entity", () => {
  test("$out and $merge into a tenant-scoped entity without its model are refused", async () => {
    /* The rows of a Purchase do not fit Memo (the compiler says so); the test is about the tenant refusal at run time. */
    const target = Memo as never;
    await expect(
      PolicyContext.run({ tenant: "ta" }, () => Purchases.aggregate((p) => p.match({ email: "x" }).out(target)).exec()),
    ).rejects.toEqual(expect.objectContaining({ name: "StrictModeError", reason: "tenant" }));
    await expect(
      PolicyContext.run({ tenant: "ta" }, () =>
        Purchases.aggregate((p) => p.match({ email: "x" }).merge({ into: target, on: "_id" })).exec(),
      ),
    ).rejects.toEqual(expect.objectContaining({ name: "StrictModeError", reason: "tenant" }));
  });

  test("two entities of one collection in one aggregation are a ConfigurationError", async () => {
    @Schema({ collection: "jp_members" })
    class MemberView extends Entity {
      @Prop(() => String, { required: true }) email!: string;
    }
    await expect(Purchases.aggregate((p) => p.unionWith(Member).unionWith(MemberView)).exec()).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });
});

describe("database-level plans: the joined entity's policies without its model", () => {
  test("connection.aggregate: lookup leaves soft-deleted documents out", async () => {
    const rows = await t.connection.aggregate(
      Pipeline.database()
        .documents([{ email: "ann@x.io" }, { email: "bob@x.io" }])
        .lookup({ from: Member, localField: "email", foreignField: "email", as: "found" })
        .plan(),
    );
    expect(counts(rows)).toEqual({ "ann@x.io": 1, "bob@x.io": 0 });
  });

  test("client.aggregate: unionWith of a tenant-scoped entity is scoped, and refused without a tenant", async () => {
    const plan = Pipeline.database()
      .documents([{ text: "x" }])
      .unionWith(Memo)
      .plan();
    const rows = await PolicyContext.run({ tenant: "tb" }, () => t.client.aggregate(plan));
    expect(rows.map((row) => row.text).sort()).toEqual(["b", "x"]);
    await expect(t.client.aggregate(plan).exec()).rejects.toEqual(
      expect.objectContaining({ name: "StrictModeError", reason: "tenant" }),
    );
  });
});
