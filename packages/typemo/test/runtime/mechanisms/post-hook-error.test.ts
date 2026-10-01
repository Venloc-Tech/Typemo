/*
 * On the real server: a `post` hook that throws after a successful write. The write stays (that is MongoDB), and
 * the caller gets a `PostHookError` — `applied: true`, the write's `result`, the hook's error in `cause` — so a
 * retry that would write twice is not mistaken for a failed write. Inside a transaction the write is rolled back
 * and the hook's error comes as it was thrown. A `postError` hook that throws keeps the error it was handling in
 * `cause`.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  CastError,
  Entity,
  type Model,
  type OperationHookContext,
  Post,
  PostError,
  PostHookError,
  Prop,
  Schema,
  TypemoError,
  ValidationError,
} from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** Which hooks throw. */
class Failing {
  static events = new Set<string>();
  static readonly error = new Error("the hook failed");
  static readonly handlerError = new Error("the postError hook failed");
}

@Schema({ collection: "ph_accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { min: 0 }) balance?: number;

  @Post("document.save") saved(this: Account): void {
    if (Failing.events.has("document.save")) throw Failing.error;
  }
  @Post("document.deleteOne") deleted(this: Account): void {
    if (Failing.events.has("document.deleteOne")) throw Failing.error;
  }
  @Post(["query.updateOne", "model.insertMany", "query.find"])
  after(this: OperationHookContext<Account>): void {
    if (Failing.events.has(this.event)) throw Failing.error;
  }
  @PostError(["query.updateOne"])
  failedQuery(this: OperationHookContext<Account>): void {
    if (Failing.events.has("postError")) throw Failing.handlerError;
  }
  @PostError("document.save") failedSave(this: Account): void {
    if (Failing.events.has("postError")) throw new Error("the document postError hook failed");
  }
}

const t = ModelLifecycle.useTypemo("ph");
let Accounts: Model<Account>;

/**
 * The number of stored accounts.
 * @returns The count.
 */
const stored = () => t.mongo.db.collection("ph_accounts").countDocuments();

/**
 * Awaits an operation that must end in a PostHookError.
 * @param promise The operation.
 * @returns The error.
 */
const postHook = async (promise: PromiseLike<unknown>): Promise<PostHookError> => {
  const error = await Promise.resolve(promise).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(PostHookError);
  expect(error).toBeInstanceOf(TypemoError);
  const hook = error as PostHookError;
  expect(hook.applied).toBe(true);
  expect(hook.cause).toBe(Failing.error);
  return hook;
};

beforeEach(async () => {
  Accounts = t.connection.model(Account);
  await t.mongo.db.collection("ph_accounts").deleteMany({});
  Failing.events = new Set();
});

describe("a post hook that throws after a successful write", () => {
  test("create: PostHookError with the saved document; the document is stored", async () => {
    Failing.events.add("document.save");
    const error = await postHook(Accounts.create({ owner: "ann" }));
    expect(error.operation).toBe("create"); /* the method the user called, not the insertOne it runs as */
    expect((error.result as Account).owner).toBe("ann");
    expect(Object.keys(error)).not.toContain("result");
    expect(await stored()).toBe(1);
  });

  test("$save of a change, $deleteOne, updateOne and insertMany", async () => {
    const doc = await Accounts.create({ owner: "ann" });
    Failing.events.add("document.save");
    doc.balance = 5;
    await postHook(doc.$save());
    expect((await t.mongo.db.collection("ph_accounts").findOne({ _id: doc._id }))?.balance).toBe(5);
    Failing.events = new Set(["query.updateOne"]);
    const update = await postHook(Accounts.updateOne({ _id: doc._id }, { $set: { balance: 6 } }));
    expect(update.result).toMatchObject({ matchedCount: 1, modifiedCount: 1 });
    Failing.events = new Set(["model.insertMany"]);
    const many = await postHook(Accounts.insertMany([{ owner: "b" }, { owner: "c" }]));
    expect((many.result as readonly Account[]).map((one) => one.owner)).toEqual(["b", "c"]);
    expect(await stored()).toBe(3);
    Failing.events = new Set(["document.deleteOne"]);
    const removed = await postHook(doc.$deleteOne());
    expect(removed.result).toMatchObject({ deletedCount: 1 });
    expect(await stored()).toBe(2);
  });

  test("a read's post hook: the hook's error as it was thrown", async () => {
    Failing.events.add("query.find");
    await expect(Accounts.find().exec()).rejects.toBe(Failing.error);
  });

  test("inside a transaction the write is rolled back and the hook's error comes as it was thrown", async () => {
    Failing.events.add("document.save");
    const error = await t.connection
      .transaction(async () => {
        await Accounts.create({ owner: "tx" });
      })
      .catch((caught: unknown) => caught);
    expect(error).toBe(Failing.error);
    expect(await stored()).toBe(0);
  });
});

describe("a postError hook that throws keeps the original error", () => {
  test("an operation hook: the original error is the cause of what is thrown", async () => {
    Failing.events.add("postError");
    const error = await Accounts.updateOne({ owner: "a" }, { $set: { balance: "x" as never } })
      .exec()
      .catch((caught: unknown) => caught);
    expect(error).toBe(Failing.handlerError);
    expect((error as Error).cause).toBeInstanceOf(CastError);
  });

  test("a document hook: the validation error is the cause of what is thrown", async () => {
    Failing.events.add("postError");
    const error = await Accounts.create({ owner: "a", balance: -1 }).catch((caught: unknown) => caught);
    expect((error as Error).message).toBe("the document postError hook failed");
    expect((error as Error).cause).toBeInstanceOf(ValidationError);
    expect(await stored()).toBe(0);
  });
});
