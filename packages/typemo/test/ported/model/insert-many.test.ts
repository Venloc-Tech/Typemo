/*
 * Ported from mongoose test/model.insertMany.test.js onto Typemo. Logic kept; where
 * Typemo reports what Mongoose drops silently (invalid documents of an unordered insertMany), the test
 * asserts the report AND the Mongoose outcome (what was written) — see
 * from-mongoose-to-typemo/DIVERGENCES.md L4A-1, L4A-2.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { Decimal128 } from "mongodb";
import {
  BulkWriteError,
  DuplicateKeyError,
  Entity,
  type Model,
  type OperationHookContext,
  Post,
  PostError,
  Pre,
  Prop,
  Schema,
  Timestamped,
  Types,
  ValidationError,
  Versioned,
} from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("ported_insertmany");

@Schema({ collection: "p_movies" })
class Movie extends Versioned(Timestamped(Entity)) {
  @Prop(() => String)
  name?: string;
}

@Schema({ collection: "p_unique_movies" })
class UniqueMovie extends Entity {
  // Typemo refuses a unique index on an optional field (a schema build check); the test's documents all have a name.
  @Prop(() => String, { unique: true, required: true })
  name!: string;
}

@Schema({ collection: "p_required_movies" })
class RequiredMovie extends Entity {
  @Prop(() => String, { required: true })
  name!: string;
}

@Schema({ collection: "p_questions" })
class Question extends Entity {
  @Prop(() => String, { required: true, unique: true })
  code!: string;

  @Prop(() => String)
  text?: string;
}

@Schema({ collection: "p_money" })
class Money extends Entity {
  @Prop(() => Types.Decimal128)
  amount?: Decimal128;
}

class HookState {
  static pre = 0;
  static post = 0;
  static postError = 0;
  static fail: Error | undefined;
}

@Schema({ collection: "p_hooked_users" })
class HookedUser extends Entity {
  @Prop(() => String)
  name?: string;

  @Pre("model.insertMany")
  before(this: OperationHookContext<HookedUser>): void {
    HookState.pre++;
    if (HookState.fail !== undefined) throw HookState.fail;
  }

  @Post("model.insertMany")
  after(this: OperationHookContext<HookedUser>): void {
    HookState.post++;
  }

  @PostError("model.insertMany")
  failed(this: OperationHookContext<HookedUser>): void {
    HookState.postError++;
  }
}

let Movies: Model<Movie>;

beforeEach(() => {
  Movies = t.connection.model(Movie);
  HookState.pre = 0;
  HookState.post = 0;
  HookState.postError = 0;
  HookState.fail = undefined;
});

describe("insertMany() (ported)", () => {
  // ported from mongoose test/model.insertMany.test.js:215 "insertMany() (gh-723)"
  test("insertMany() (gh-723)", async () => {
    let docs = await Movies.insertMany([{ name: "Star Wars" }, { name: "The Empire Strikes Back" }]);
    expect(docs.length).toBe(2);
    expect(docs[0]?.createdAt).toBeInstanceOf(Date);
    expect(docs[1]?.createdAt).toBeInstanceOf(Date);
    expect(docs[0]?.__v).toBe(0);
    expect(docs[1]?.__v).toBe(0);
    docs = await Movies.find({});
    expect(docs.length).toBe(2);
    expect(docs[0]?.createdAt).toBeInstanceOf(Date);
  });

  // ported from mongoose test/model.insertMany.test.js:235 "insertMany() ordered option for constraint errors (gh-3893)"
  test("insertMany() ordered option for constraint errors (gh-3893) — divergence L4A-2: a BulkWriteError, not a raw E11000", async () => {
    const Unique = t.connection.model(UniqueMovie);
    await Unique.createIndexes();
    const error = await Unique.insertMany(
      [{ name: "Star Wars" }, { name: "Star Wars" }, { name: "The Empire Strikes Back" }],
      { ordered: false },
    ).catch((caught: unknown) => caught);
    const bulk = error as BulkWriteError;
    expect(bulk).toBeInstanceOf(BulkWriteError);
    expect(bulk.writeErrors.length).toBe(1);
    expect(bulk.writeErrors[0]?.index).toBe(1);
    expect(bulk.writeErrors[0]?.message.includes("E11000")).toBe(true);
    expect(bulk.writeErrors[0]?.error).toBeInstanceOf(DuplicateKeyError);
    expect(Object.keys(bulk.result.insertedIds).map(Number)).toEqual([0, 2]);
    const docs = await Unique.find({}).sort({ name: 1 });
    expect(docs.length).toBe(2);
    expect(docs[0]?.name).toBe("Star Wars");
    expect(docs[1]?.name).toBe("The Empire Strikes Back");
  });

  // ported from mongoose test/model.insertMany.test.js:311 "insertMany() ordered option for validation errors (gh-5068)"
  test("insertMany() ordered option for validation errors (gh-5068) — divergence L4A-1: the invalid one is reported", async () => {
    const Required = t.connection.model(RequiredMovie);
    const error = await Required.insertMany(
      [{ name: "Star Wars" }, { foo: "Star Wars" } as never, { name: "The Empire Strikes Back" }],
      { ordered: false },
    ).catch((caught: unknown) => caught);
    // Mongoose resolves and drops the invalid document silently; Typemo reports it — and writes the same.
    expect((error as BulkWriteError).writeErrors.map((failure) => [failure.index, failure.error.name])).toEqual([
      [1, "CastError"], // the unknown key "foo" (strict keys)
    ]);
    const docs = await Required.find({}).sort({ name: 1 });
    expect(docs.length).toBe(2);
    expect(docs[0]?.name).toBe("Star Wars");
    expect(docs[1]?.name).toBe("The Empire Strikes Back");
  });

  // ported from mongoose test/model.insertMany.test.js:337 "insertMany() `writeErrors` if only one error (gh-8938)"
  test("insertMany() `writeErrors` if only one error (gh-8938)", async () => {
    const Questions = t.connection.model(Question);
    await Questions.createIndexes();
    await Questions.create({ code: "MEDIUM", text: "123" });
    const data = [
      { code: "MEDIUM", text: "1111" },
      { code: "test", text: "222" },
      { code: "HARD", text: "2222" },
    ];
    let error = (await Questions.insertMany(data, { ordered: false }).catch(
      (caught: unknown) => caught,
    )) as BulkWriteError;
    expect(Array.isArray(error.writeErrors)).toBe(true);
    expect(error.writeErrors.length).toBe(1);
    expect(Object.keys(error.result.insertedIds).length).toBe(2);
    expect(error.writeErrors[0]?.message.includes("E11000")).toBe(true);
    await Questions.deleteMany({ code: { $exists: true } });
    await Questions.create({ code: "MEDIUM", text: "123" });
    await Questions.create({ code: "HARD", text: "123" });
    error = (await Questions.insertMany(data, { ordered: false }).catch((caught: unknown) => caught)) as BulkWriteError;
    expect(error.writeErrors.length).toBe(2);
    expect(Object.keys(error.result.insertedIds).length).toBe(1);
  });

  // ported from mongoose test/model.insertMany.test.js:378 "insertMany() ordered option for single validation error"
  test("insertMany() ordered option for single validation error — divergence L4A-1: reported, nothing written", async () => {
    const Required = t.connection.model(RequiredMovie);
    const error = await Required.insertMany(
      [{ foo: "Star Wars" } as never, { foo: "The Fast and the Furious" } as never],
      {
        ordered: false,
      },
    ).catch((caught: unknown) => caught);
    expect((error as BulkWriteError).writeErrors.length).toBe(2);
    expect((await Required.find({})).length).toBe(0);
  });

  // ported from mongoose test/model.insertMany.test.js:402 "insertMany() hooks (gh-3846)"
  test("insertMany() hooks (gh-3846) — pre/post run once; changing the documents from a pre hook is covered by the hook tests", async () => {
    const Users = t.connection.model(HookedUser);
    const docs = await Users.insertMany([{ name: "Star Wars" }, { name: "The Empire Strikes Back" }]);
    expect(docs.length).toBe(2);
    expect(HookState.pre).toBe(1);
    expect(HookState.post).toBe(1);
  });

  // ported from mongoose test/model.insertMany.test.js:433 "returns empty array if no documents (gh-8130)"
  test("returns empty array if no documents (gh-8130)", async () => {
    expect(await Movies.insertMany([])).toEqual([]);
  });

  // ported from mongoose test/model.insertMany.test.js:438 "insertMany() multi validation error with ordered false (gh-5337)"
  test("insertMany() multi validation error with ordered false (gh-5337) — divergence L4A-1 (no rawResult: the errors are on the BulkWriteError)", async () => {
    const Required = t.connection.model(RequiredMovie);
    const error = (await Required.insertMany(
      [
        { foo: "The Phantom Menace" } as never,
        { name: "Star Wars" },
        { name: "The Empire Strikes Back" },
        { foobar: "The Force Awakens" } as never,
      ],
      { ordered: false },
    ).catch((caught: unknown) => caught)) as BulkWriteError;
    expect(error.writeErrors.length).toBe(2);
    expect(error.writeErrors.every((failure) => failure.code === undefined)).toBe(true);
  });

  // ported from mongoose test/model.insertMany.test.js:457 "insertMany() validation error with ordered true when all documents are invalid"
  test("insertMany() validation error with ordered true when all documents are invalid", async () => {
    const Required = t.connection.model(RequiredMovie);
    const error = await Required.insertMany([{ name: 1 } as never, { name: 2 } as never], { ordered: true }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect([ValidationError.name, "CastError", "ValidationError"]).toContain((error as Error).name);
  });

  // ported from mongoose test/model.insertMany.test.js:818 "insertMany with Decimal (gh-5190)"
  test("insertMany with Decimal (gh-5190)", async () => {
    const Moneys = t.connection.model(Money);
    await Moneys.insertMany([{ amount: "123.45" as never }]);
    expect((await Moneys.findOne().lean().orFail()).amount?.toString()).toBe("123.45");
  });

  // ported from mongoose test/model.insertMany.test.js:869 "insertMany() should throw when pre-hook throws an error"
  test("insertMany() should throw when pre-hook throws an error", async () => {
    HookState.fail = new Error("Pre-hook error - should stop insertMany");
    const error = await t.connection
      .model(HookedUser)
      .insertMany([{ name: "test1" }, { name: "test2" }])
      .catch((caught: unknown) => caught);
    expect((error as Error).message).toBe("Pre-hook error - should stop insertMany");
  });

  // ported from mongoose test/model.insertMany.test.js:882 "insertMany() should not insert documents when pre-hook throws"
  test("insertMany() should not insert documents when pre-hook throws", async () => {
    HookState.fail = new Error("Pre-hook error - should stop insertMany");
    const Users = t.connection.model(HookedUser);
    await Users.insertMany([{ name: "test1" }, { name: "test2" }]).catch(() => undefined);
    expect(await Users.countDocuments()).toBe(0);
  });

  // ported from mongoose test/model.insertMany.test.js:895 "insertMany() should call error post hook when pre-hook throws"
  test("insertMany() should call error post hook when pre-hook throws", async () => {
    HookState.fail = new Error("Pre-hook error - should stop insertMany");
    await t.connection
      .model(HookedUser)
      .insertMany([{ name: "test1" }])
      .catch(() => undefined);
    expect(HookState.postError).toBe(1);
    expect(HookState.post).toBe(0);
  });
});
