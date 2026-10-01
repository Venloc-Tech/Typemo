/*
 * Validation of a save on the real server — built-in and user validators (sync and async) with
 * a `ValidationContext`, every issue in ONE `ValidationError`; a new document validates every field, an
 * existing one the paths it writes, including changes inside arrays and subdocuments.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { Entity, type Model, Prop, Schema, type ValidationContext, ValidationError } from "../../../src/index.ts";
import { Order, ValidatorLog } from "../../fixtures/document/document-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const contexts: ValidationContext[] = [];

/** An entity with built-in and user validators; the user ones record the context they were given. */
@Schema({ collection: "d_validated" })
class Validated extends Entity {
  @Prop(() => String, { required: true, match: /^[a-z]+$/, minLength: 2 })
  slug!: string;

  @Prop(() => String, { enum: ["a", "b"] })
  kind?: "a" | "b";

  @Prop(() => Number, {
    min: 1,
    validate: (value: number, context: ValidationContext) => {
      contexts.push(context);
      return value !== 13 || "13 is unlucky";
    },
  })
  score?: number;

  @Prop(() => [Number], { validate: (value: number[]) => value.length <= 3 || "at most 3" })
  list?: number[];
}

const t = ModelLifecycle.useTypemo("doc_validation");
let Items: Model<Validated>;
let Orders: Model<Order>;

beforeEach(() => {
  Items = t.connection.model(Validated);
  Orders = t.connection.model(Order);
  contexts.length = 0;
  ValidatorLog.calls = [];
});

/**
 * Awaits a promise that must reject with a `ValidationError`.
 * @param promise The operation expected to fail validation.
 * @returns The validation error.
 */
const failure = async (promise: Promise<unknown>): Promise<ValidationError> => {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ValidationError);
  return error as ValidationError;
};

describe("a new document: every field", () => {
  test("every issue in one ValidationError, nothing written", async () => {
    const error = await failure(Items.create({ slug: "A", kind: "c" as never, score: 0, list: [1, 2, 3, 4] }));
    /* In the order of the schema fields (slug, kind, score, list). */
    expect(error.issues.map((issue) => [issue.path.join("."), issue.reason])).toEqual([
      ["slug", "minLength"],
      ["slug", "match"],
      ["kind", "enum"],
      ["score", "min"],
      ["list", "validator"],
    ]);
    expect(await Items.countDocuments()).toBe(0);
  });

  test("required: absent is an issue; the validator gets the document context", async () => {
    const error = await failure(Items.new({ score: 13 } as never).$save());
    expect(error.errors.slug?.[0]?.reason).toBe("required");
    expect(error.errors.score?.[0]?.message).toBe("13 is unlucky");
    expect(contexts).toEqual([{ kind: "document", operation: "save", path: "score" }]);
  });

  test("async validators run (and are awaited) on save", async () => {
    await failure(Orders.create({ customer: "forbidden", tags: [], lines: [] }));
    expect(ValidatorLog.calls).toEqual(["forbidden"]);
  });
});

/** Fields declared so that neither alphabetical order nor "sync first, async last" matches the schema order. */
@Schema({ collection: "d_validation_order" })
class Ordered extends Entity {
  @Prop(() => Number, { min: 10 })
  size?: number;

  @Prop(() => String, {
    validate: async (value: string) => {
      await Bun.sleep(5);
      return value !== "bad" || "bad name";
    },
  })
  name?: string;

  @Prop(() => String, { enum: ["x", "y"] })
  kind?: "x" | "y";

  @Prop(() => [Ordered2], {})
  parts?: Ordered2[];
}

/** An element schema, to order issues inside an array of subdocuments. */
@Schema({ nested: true })
class Ordered2 {
  @Prop(() => Number, { max: 1 })
  z?: number;

  @Prop(() => Number, { max: 1 })
  a?: number;
}

describe("the order of the issues is the order of the schema fields", () => {
  const input = { size: 1, name: "bad", kind: "q", parts: [{ z: 5, a: 5 }, { a: 5 }] } as never;
  const expected = [
    ["size", "min"],
    ["name", "validator"],
    ["kind", "enum"],
    ["parts.0.z", "max"],
    ["parts.0.a", "max"],
    ["parts.1.a", "max"],
  ];
  const shape = (error: ValidationError) => error.issues.map((issue) => [issue.path.join("."), issue.reason]);

  test("$validate(): async validators do not move their issue", async () => {
    const Model = t.connection.model(Ordered);
    expect(shape(await failure(Model.new(input).$validate()))).toEqual(expected);
  });

  test("Model.validate(): the same order", async () => {
    const Model = t.connection.model(Ordered);
    expect(shape(await failure(Model.validate(input)))).toEqual(expected);
  });
});

describe("an existing document: the modified paths", () => {
  test("an unmodified invalid field is not validated; a modified one is", async () => {
    const item = await Items.create({ slug: "ok" });
    await t.mongo.db.collection("d_validated").updateOne({ _id: item._id }, { $set: { kind: "zzz" } });
    const loaded = await Items.findById(item._id).orFail();
    loaded.score = 5;
    await loaded.$save(); /* `kind` is invalid in the database, but was not changed */
    loaded.score = 0;
    const error = await failure(loaded.$save());
    expect(error.issues.map((issue) => issue.path.join("."))).toEqual(["score"]);
  });

  test("a change inside an array: the element and the array's own validator", async () => {
    const order = await Orders.create({ customer: "ann", tags: [], lines: [{ sku: "x", qty: 1 }] });
    order.lines[0]?.$set("qty", -1);
    const error = await failure(order.$save());
    expect(error.issues.map((issue) => [issue.path.join("."), issue.reason])).toEqual([["lines.0.qty", "min"]]);
    const item = await Items.create({ slug: "ok", list: [1] });
    item.list?.push(2, 3, 4);
    expect((await failure(item.$save())).issues[0]?.message).toBe("at most 3");
  });

  test("$validate() checks every loaded field", async () => {
    const item = await Items.create({ slug: "ok" });
    await t.mongo.db.collection("d_validated").updateOne({ _id: item._id }, { $set: { kind: "zzz" } });
    const loaded = await Items.findById(item._id).orFail();
    const error = await failure(loaded.$validate());
    expect(error.issues[0]?.path).toEqual(["kind"]);
  });
});
