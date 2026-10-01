/*
 * On the real server: an update pipeline that rewrites the whole document (`$project`, `$replaceRoot`,
 * `$replaceWith`) on a model with immutable fields (`Timestamped` has one, `createdAt`) is allowed when the new
 * root carries every immutable field unchanged; anything else is still a `StrictModeError` (immutable) before
 * anything is sent.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { type Document, ObjectId } from "mongodb";
import {
  Entity,
  fn,
  type Immutable,
  type Model,
  Prop,
  Schema,
  StrictModeError,
  Timestamped,
} from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** A document with a stored-name immutable field next to the `Timestamped` one. */
@Schema({ collection: "pwd_docs" })
class Doc extends Timestamped(Entity) {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String, { immutable: true, dbName: "own" })
  owner!: Immutable<string>;

  @Prop(() => String)
  note?: string;

  @Prop(() => Number)
  score?: number;
}

/* The same without stored names: `$$ROOT` of a model with `dbName` fields is refused in a pipeline. */
@Schema({ collection: "pwd_plain" })
class Plain extends Timestamped(Entity) {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String, { immutable: true })
  owner!: Immutable<string>;

  @Prop(() => Number)
  score?: number;
}

const t = ModelLifecycle.useTypemo("pwd");
const id = new ObjectId();
let Docs: Model<Doc>;
let Plains: Model<Plain>;

beforeEach(async () => {
  Docs = t.connection.model(Doc);
  Plains = t.connection.model(Plain);
  await t.mongo.db.collection("pwd_docs").deleteMany({});
  await t.mongo.db.collection("pwd_plain").deleteMany({});
  await Plains.insertOne({ _id: id, name: "first", owner: "ann", score: 1 } as never);
  await Docs.insertOne({ _id: id, name: "first", owner: "ann", note: "n", score: 1 } as never);
  t.commands.clear();
});

/**
 * The stored document.
 * @returns The raw document of the test row.
 */
const stored = async (): Promise<Document> => (await t.mongo.db.collection("pwd_docs").findOne({ _id: id })) ?? {};

/**
 * The error an operation rejects with.
 * @param run - Starts the operation.
 * @returns What it rejected with, or `undefined`.
 */
const errorOf = async (run: () => PromiseLike<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe("a whole-document stage that carries the immutable fields", () => {
  test("$replaceWith with createdAt and owner carried: the other fields are replaced, the immutable ones stay", async () => {
    const before = await stored();
    await Docs.updateOne({ _id: id }, (p) =>
      p.replaceWith((f) => ({ name: fn.literal("second"), owner: f.owner, createdAt: f.createdAt })),
    );
    const after = await stored();
    expect(after.name).toBe("second");
    expect(after.own).toBe("ann");
    expect(after.createdAt).toEqual(before.createdAt);
    expect("note" in after).toBe(false);
    expect("score" in after).toBe(false);
  });

  test("$replaceRoot does the same", async () => {
    const before = await stored();
    await Docs.updateOne({ _id: id }, (p) =>
      p.replaceRoot((f) => ({ name: fn.literal("viaRoot"), owner: f.owner, createdAt: f.createdAt })),
    );
    const after = await stored();
    expect(after.name).toBe("viaRoot");
    expect(after.own).toBe("ann");
    expect(after.createdAt).toEqual(before.createdAt);
  });

  test("an inclusion $project keeps the immutable fields it lists; the rest vanishes", async () => {
    await Docs.updateOne({ _id: id }, (p) => p.project({ name: 1, owner: 1, createdAt: 1 }));
    const after = await stored();
    expect(after.name).toBe("first");
    expect(after.own).toBe("ann");
    expect("note" in after).toBe(false);
    expect("score" in after).toBe(false);
  });

  test("an exclusion $project that leaves the immutable fields alone is allowed", async () => {
    await Docs.updateOne({ _id: id }, (p) => p.project({ note: 0, score: 0 }));
    const after = await stored();
    expect("note" in after).toBe(false);
    expect(after.own).toBe("ann");
  });

  test("$replaceWith of $mergeObjects over the root with fields that are not immutable", async () => {
    await Plains.updateOne({ _id: id }, (p) => p.replaceWith((f) => fn.mergeObjects(f, { score: fn.literal(9) })));
    const after: Document = (await t.mongo.db.collection("pwd_plain").findOne({ _id: id })) ?? {};
    expect(after.score).toBe(9);
    expect(after.owner).toBe("ann");
    expect(after.name).toBe("first");
  });

  test("the updatedAt stamp still moves", async () => {
    const before = await stored();
    await Docs.updateOne({ _id: id }, (p) =>
      p.replaceWith((f) => ({ name: fn.literal("second"), owner: f.owner, createdAt: f.createdAt })),
    );
    const after = await stored();
    expect((after.updatedAt as Date).getTime()).toBeGreaterThanOrEqual((before.updatedAt as Date).getTime());
  });
});

describe("a whole-document stage that does not carry them is refused before sending", () => {
  const refused = async (run: () => PromiseLike<unknown>, fields: string): Promise<void> => {
    const error = await errorOf(run);
    expect(error).toBeInstanceOf(StrictModeError);
    expect((error as StrictModeError).reason).toBe("immutable");
    expect((error as Error).message).toContain(fields);
    expect(t.commands.byName("update")).toHaveLength(0);
    expect((await stored()).name).toBe("first");
  };

  test("$replaceWith without the immutable fields", async () => {
    await refused(
      () => Docs.updateOne({ _id: id }, (p) => p.replaceWith(() => ({ name: fn.literal("x") }))),
      "createdAt, owner",
    );
  });

  test("$replaceWith that carries createdAt but overwrites owner with a constant", async () => {
    await refused(
      () =>
        Docs.updateOne({ _id: id }, (p) =>
          p.replaceWith((f) => ({ name: fn.literal("x"), owner: fn.literal("bob"), createdAt: f.createdAt })),
        ),
      "owner",
    );
  });

  test("$replaceWith that carries createdAt from another field", async () => {
    await refused(
      () =>
        Docs.updateOne({ _id: id }, (p) =>
          p.replaceWith((f) => ({ name: fn.literal("x"), owner: f.owner, createdAt: f.updatedAt })),
        ),
      "createdAt",
    );
  });

  test("$replaceRoot of an expression the policy cannot read as unchanged", async () => {
    await refused(
      () => Docs.updateOne({ _id: id }, (p) => p.replaceRoot((f) => fn.mergeObjects({ name: fn.literal("x") }, f))),
      "createdAt, owner",
    );
  });

  test("an inclusion $project without the immutable fields", async () => {
    await refused(() => Docs.updateOne({ _id: id }, (p) => p.project({ name: 1 })), "createdAt, owner");
  });

  test("an exclusion $project of an immutable field", async () => {
    await refused(() => Docs.updateOne({ _id: id }, (p) => p.project({ owner: 0 })), "owner");
  });

  test("$mergeObjects over the root that names an immutable field", async () => {
    await refused(
      () => Docs.updateOne({ _id: id }, (p) => p.replaceWith((f) => fn.mergeObjects(f, { owner: fn.literal("bob") }))),
      "owner",
    );
  });
});
