/*
 * Strict reading (`validateReads`): off by default, a client option (`true` / `"development"`) and a per-query
 * `.validateReads(enabled)`. The documents are written through the raw driver, so their values do not have the
 * declared types; the check is a `CastError` with the path, in every result form, for populated documents too.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, test } from "bun:test";
import { MongoHarness } from "@venloc/typemo-test-kit";
import { ObjectId } from "mongodb";
import {
  CastError,
  ConfigurationError,
  Entity,
  type Hidden,
  Prop,
  type Ref,
  Schema,
  Spec,
  TypemoClient,
  Types,
} from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

@Schema()
class VrLine {
  @Prop(() => String, { required: true })
  sku!: string;

  @Prop(() => Number)
  qty?: number;
}

@Schema({ collection: "vr_owners" })
class VrOwner extends Entity {
  @Prop(() => String, { required: true })
  name!: string;
}

@Schema({ collection: "vr_orders" })
class VrOrder extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => String, { nullable: true })
  note?: string | null;

  @Prop(() => [VrLine])
  lines!: VrLine[];

  @Prop(() => Spec.map(Number))
  scores?: Map<string, number>;

  @Prop(() => String, { hidden: true })
  secret?: Hidden<string>;

  @Prop(() => String, { sensitive: "mask" })
  token?: string;

  @Prop(() => Types.ObjectId, { ref: () => VrOwner })
  owner?: Ref<VrOwner>;
}

const t = ModelLifecycle.useTypemo("query_validate_reads");
let strict: TypemoClient;
const raw = () => t.mongo.db.collection("vr_orders");
const id = new ObjectId();
const ownerId = new ObjectId();

/**
 * The CastError a promise rejects with.
 * @param run The read.
 * @returns The error.
 */
const castError = async (run: PromiseLike<unknown>): Promise<CastError> => {
  try {
    await run;
  } catch (error) {
    if (error instanceof CastError) return error;
    throw error;
  }
  throw new Error("the read did not fail");
};

beforeAll(async () => {
  strict = await TypemoClient.connect(MongoHarness.getUri(), { dbName: t.mongo.dbName, validateReads: true });
});

afterAll(async () => {
  await strict?.close();
});

beforeEach(async () => {
  await t.mongo.db.collection("vr_owners").insertOne({ _id: ownerId, name: "Ann" });
  await raw().insertOne({ _id: id, title: 5, lines: [], owner: ownerId });
});

describe("validateReads: off by default", () => {
  test("a stored value of another type is read as it is without the option", async () => {
    const Orders = t.connection.model(VrOrder);
    expect(t.client.options.validateReads).toBe(false);
    const row = await Orders.findById(id).lean();
    expect(row?.title as unknown).toBe(5);
  });

  test(".validateReads() turns the check on for one query", async () => {
    const Orders = t.connection.model(VrOrder);
    const error = await castError(Orders.findById(id).validateReads());
    expect([error.path, error.reason, error.expected, error.value]).toEqual(["title", "type", "string", 5]);
    expect(error.message).toBe(
      'Cast to string failed at path "title" for 5 (number): the stored value does not match the schema of VrOrder (a document read from the database, checked by validateReads) [type]',
    );
  });
});

describe("validateReads: true on the client", () => {
  test("every result form and every read method fails with the path", async () => {
    const Orders = strict.connection.model(VrOrder);
    expect(strict.options.validateReads).toBe(true);
    for (const run of [
      Orders.find({}),
      Orders.find({}).lean(),
      Orders.find({}).plain(),
      Orders.findOne({ _id: id }),
      Orders.findById(id),
      Orders.findOneAndUpdate({ _id: id }, { $set: { note: "x" } }),
    ]) {
      expect((await castError(run)).path).toBe("title");
    }
    await expect(Orders.find({}).cursor().next()).rejects.toBeInstanceOf(CastError);
  });

  test(".validateReads(false) turns it off for one query", async () => {
    const Orders = strict.connection.model(VrOrder);
    const row = await Orders.findById(id).validateReads(false).lean();
    expect(row?.title as unknown).toBe(5);
  });

  test("a valid document passes; a projection that leaves the bad field out passes", async () => {
    const Orders = strict.connection.model(VrOrder);
    await raw().insertOne({ title: "ok", note: null, lines: [{ sku: "a", qty: 1 }], scores: { x: 1.5 } });
    expect((await Orders.findOne({ title: "ok" }).lean())?.title).toBe("ok");
    expect((await Orders.findById(id).select({ lines: 1 }).lean())?.lines).toEqual([]);
  });

  test("arrays of subdocuments, Maps, null on a path that is not nullable", async () => {
    const Orders = strict.connection.model(VrOrder);
    await raw().deleteMany({});
    await raw().insertOne({ _id: id, title: "a", lines: [{ sku: "a" }, { sku: 7 }] });
    expect((await castError(Orders.findById(id).lean())).path).toBe("lines.1.sku");
    await raw().updateOne({ _id: id }, { $set: { lines: [], scores: { x: "high" } } });
    expect((await castError(Orders.findById(id))).path).toBe("scores.x");
    await raw().updateOne({ _id: id }, { $set: { scores: {}, title: null } });
    const nulled = await castError(Orders.findById(id).lean());
    expect([nulled.path, nulled.reason]).toEqual(["title", "null"]);
    await raw().updateOne({ _id: id }, { $set: { title: "a", lines: "none" } });
    const notArray = await castError(Orders.findById(id).lean());
    expect([notArray.path, notArray.expected]).toEqual(["lines", "Array"]);
  });

  test("a sensitive or Hidden field shows its value masked", async () => {
    const Orders = strict.connection.model(VrOrder);
    await raw().updateOne({ _id: id }, { $set: { title: "a", token: 42 } });
    const token = await castError(Orders.findById(id).lean());
    expect([token.path, token.value, token.message.includes("42")]).toEqual(["token", "?", false]);
    await raw().updateOne({ _id: id }, { $set: { token: "t", secret: 43 } });
    const secret = await castError(Orders.findById(id).select({ "+secret": true }).lean());
    expect([secret.path, secret.value]).toEqual(["secret", "?"]);
  });

  test("populated documents are checked too", async () => {
    const Orders = strict.connection.model(VrOrder);
    strict.connection.model(VrOwner);
    await raw().updateOne({ _id: id }, { $set: { title: "a" } });
    expect((await Orders.findById(id).populate("owner").lean())?.owner).toMatchObject({ name: "Ann" });
    await t.mongo.db.collection("vr_owners").updateOne({ _id: ownerId }, { $set: { name: ["Ann"] } });
    expect((await castError(Orders.findById(id).populate("owner").lean())).path).toBe("name");
    const off = await Orders.findById(id).populate("owner").validateReads(false).lean();
    expect((off?.owner as { readonly name: unknown } | undefined)?.name).toEqual(["Ann"]);
  });
});

describe("the option itself", () => {
  test("types: .validateReads() keeps the query type; the argument is a boolean", () => {
    const Orders = t.connection.model(VrOrder);
    const lean = Orders.findById(id).lean();
    expectTypeOf(lean.validateReads()).toEqualTypeOf(lean);
    expectTypeOf(lean.validateReads(false)).toEqualTypeOf(lean);
    // @ts-expect-error validateReads takes a boolean, not a string
    expect(() => Orders.find().validateReads("on")).toThrow("validateReads: true or false");
  });

  test('"development" follows NODE_ENV; a wrong value is a ConfigurationError', () => {
    const uri = MongoHarness.getUri();
    const saved = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(new TypemoClient(uri, { validateReads: "development" }).options.validateReads).toBe(false);
      process.env.NODE_ENV = "development";
      expect(new TypemoClient(uri, { validateReads: "development" }).options.validateReads).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = saved;
    }
    // @ts-expect-error validateReads is true, false or "development"
    expect(() => new TypemoClient(uri, { validateReads: "yes" })).toThrow(ConfigurationError);
  });
});
