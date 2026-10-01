/*
 * On the real server: `$inc`/`$mul` on fields with `min`/`max` are CONDITIONAL —
 * the filter gets `$expr` with the server's arithmetic on the stored value, so an out-of-range result is
 * never written; a failed guard is told from a missing document by a follow-up read in the same session.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { DocumentNotFoundError, Entity, type Model, Prop, Schema, Spec, ValidationError } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** A nested object with a guarded counter. */
@Schema()
class Stock {
  @Prop(() => Number, { min: 0 })
  onHand?: number;
}

/** An array element with a guarded quantity. */
@Schema()
class Line {
  @Prop(() => Number, { min: 0 })
  qty!: number;
}

/** A root with guarded numbers at several depths. */
@Schema({ collection: "j4_wallets" })
class Wallet extends Entity {
  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => Number, { min: 0, max: 100, dbName: "bal" })
  balance?: number;

  @Prop(() => BigInt, { min: 0n })
  points?: bigint;

  @Prop(() => Number)
  free?: number;

  @Prop(() => Stock)
  stock?: Stock;

  @Prop(() => Spec.map(Number))
  counters?: Map<string, number>;

  @Prop(() => [Line])
  lines?: Line[];
}

const t = ModelLifecycle.useTypemo("j4");
const ann = new ObjectId();
const bob = new ObjectId();
let Wallets: Model<Wallet>;

/**
 * The raw wallets collection.
 * @returns The driver collection.
 */
const raw = () => t.mongo.db.collection("j4_wallets");
/**
 * Reads a wallet straight from the collection.
 * @param id The wallet id.
 * @returns The stored raw document.
 */
const stored = async (id: ObjectId) => raw().findOne({ _id: id });

beforeEach(async () => {
  Wallets = t.connection.model(Wallet);
  await raw().insertMany([
    { _id: ann, owner: "ann", bal: 10, points: 5n, stock: { onHand: 2 }, counters: { a: 1 }, lines: [{ qty: 1 }] },
    { _id: bob, owner: "bob", bal: 95 },
  ]);
  t.commands.clear();
});

/**
 * Awaits an operation that must fail the guard.
 * @param promise The operation.
 * @returns The `ValidationError` it rejected with.
 */
const guardError = async (promise: PromiseLike<unknown>): Promise<ValidationError> => {
  const error = await Promise.resolve(promise).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ValidationError);
  return error as ValidationError;
};

describe("updateOne", () => {
  test("in range: applied; the filter carries the guard in database names", async () => {
    const result = await Wallets.updateOne({ _id: ann }, { $inc: { balance: -10 } });
    expect(result.modifiedCount).toBe(1);
    expect((await stored(ann))?.bal).toBe(0);
    const [command] = t.commands.byName("update");
    expect(command?.command.updates[0].q).toEqual({
      $and: [
        { _id: ann },
        {
          $expr: {
            $and: [
              { $gte: [{ $add: [{ $ifNull: ["$bal", 0] }, -10] }, 0] },
              { $lte: [{ $add: [{ $ifNull: ["$bal", 0] }, -10] }, 100] },
            ],
          },
        },
      ],
    });
  });

  test("out of range: ValidationError with the stored value and the result; nothing written", async () => {
    const error = await guardError(Wallets.updateOne({ _id: ann }, { $inc: { balance: -11 } }));
    expect(error.issues).toEqual([expect.objectContaining({ path: ["balance"], reason: "min", value: -1 })]);
    expect(error.message).toMatch(/\$inc -11 on 10 gives -1, below the minimum 0; nothing was written/);
    expect((await stored(ann))?.bal).toBe(10);
    const max = await guardError(Wallets.updateOne({ _id: bob }, { $inc: { balance: 6 } }));
    expect(max.issues[0]?.reason).toBe("max");
    /* the follow-up read ran after the update that matched nothing */
    expect(t.commands.all().map((c) => c.commandName)).toEqual(["update", "find", "update", "find"]);
  });

  test("no document: the ordinary result (no error), orFail → DocumentNotFoundError", async () => {
    const missing = new ObjectId();
    expect((await Wallets.updateOne({ _id: missing }, { $inc: { balance: 1 } })).matchedCount).toBe(0);
    await expect(
      Wallets.updateOne({ _id: missing }, { $inc: { balance: 1 } })
        .orFail()
        .exec(),
    ).rejects.toThrow(DocumentNotFoundError);
  });

  test("an absent field counts as 0 (as $inc/$mul treat it)", async () => {
    await raw().updateOne({ _id: bob }, { $unset: { bal: "" } });
    const error = await guardError(Wallets.updateOne({ _id: bob }, { $inc: { balance: -1 } }));
    expect(error.message).toMatch(/on \(absent\) gives -1/);
    await Wallets.updateOne({ _id: bob }, { $inc: { balance: 1 } });
    expect((await stored(bob))?.bal).toBe(1);
  });

  test("$mul, int64 and nested paths are guarded too; a Map entry (no min/max on Map values) is not", async () => {
    await guardError(Wallets.updateOne({ _id: ann }, { $mul: { balance: 11 } }));
    await Wallets.updateOne({ _id: ann }, { $mul: { balance: 10 } });
    expect((await stored(ann))?.bal).toBe(100);
    const long = await guardError(Wallets.updateOne({ _id: ann }, { $inc: { points: -6n } }));
    expect(long.issues[0]?.value).toBe(-1n);
    await Wallets.updateOne({ _id: ann }, { $inc: { points: -5n } });
    expect((await stored(ann))?.points).toBe(0n);
    await guardError(Wallets.updateOne({ _id: ann }, { $inc: { "stock.onHand": -3 } }));
    await Wallets.updateOne({ _id: ann }, { $inc: { "counters.a": -2, "stock.onHand": -2 } });
    expect(await stored(ann)).toMatchObject({ stock: { onHand: 0 }, counters: { a: -1 } });
  });

  test("a field without min/max is not guarded (the filter is unchanged)", async () => {
    await Wallets.updateOne({ _id: ann }, { $inc: { free: -1000 } });
    expect(t.commands.byName("update")[0]?.command.updates[0].q).toEqual({ _id: ann });
  });
});

describe("updateMany and findOneAndUpdate", () => {
  test("updateMany: one document out of range → ValidationError BEFORE the write; nothing written", async () => {
    const error = await guardError(Wallets.updateMany({ owner: { $in: ["ann", "bob"] } }, { $inc: { balance: 6 } }));
    expect(error.issues[0]?.reason).toBe("max");
    expect((await stored(ann))?.bal).toBe(10);
    expect(t.commands.byName("update").length).toBe(0);
    const ok = await Wallets.updateMany({ owner: { $in: ["ann", "bob"] } }, { $inc: { balance: 5 } });
    expect(ok.modifiedCount).toBe(2);
  });

  test("updateMany by _id is handled like updateOne — one round trip on success, no pre-check", async () => {
    const ok = await Wallets.updateMany({ _id: ann }, { $inc: { balance: 5 } });
    expect(ok.modifiedCount).toBe(1);
    expect(t.commands.all().map((command) => command.commandName)).toEqual(["update"]);
    t.commands.clear();
    const error = await guardError(Wallets.updateMany({ _id: ann }, { $inc: { balance: 100 } }));
    expect(error.issues[0]?.reason).toBe("max");
    expect(t.commands.all().map((command) => command.commandName)).toEqual(["update", "find"]);
    expect((await stored(ann))?.bal).toBe(15);
    const none = await Wallets.updateMany({ _id: new ObjectId() }, { $inc: { balance: 1 } });
    expect(none.matchedCount).toBe(0);
    /* an operator on _id may select several documents: the pre-check stays */
    t.commands.clear();
    await Wallets.updateMany({ _id: { $in: [ann, bob] } }, { $inc: { balance: 1 } });
    expect(t.commands.all().map((command) => command.commandName)).toEqual(["find", "update"]);
  });

  test("findOneAndUpdate: out of range → ValidationError; missing → null", async () => {
    await guardError(Wallets.findOneAndUpdate({ _id: ann }, { $inc: { balance: -20 } }));
    expect(await Wallets.findOneAndUpdate({ _id: new ObjectId() }, { $inc: { balance: 1 } })).toBeNull();
    expect((await Wallets.findOneAndUpdate({ _id: ann }, { $inc: { balance: 1 } }))?.balance).toBe(11);
  });

  test("inside a transaction the follow-up read uses the same session", async () => {
    const error = await t.connection
      .transaction(async () => {
        await Wallets.updateOne({ _id: ann }, { $inc: { balance: -100 } });
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    const finds = t.commands.byName("find");
    expect(finds.at(-1)?.command.lsid).toEqual(t.commands.byName("update").at(-1)?.command.lsid);
  });
});

describe("refused before sending", () => {
  test("an upsert (a failed guard would insert a new document)", async () => {
    await guardError(Wallets.updateOne({ owner: "cy" }, { $inc: { balance: 1 } }, { upsert: true }));
    expect(t.commands.all().length).toBe(0);
  });

  test("bulkWrite (no per-operation match count)", async () => {
    await expect(
      Wallets.bulkWrite([{ updateOne: { filter: { _id: ann }, update: { $inc: { balance: 1 } } } }]),
    ).rejects.toThrow(/cannot be guarded in bulkWrite/);
    expect(t.commands.byName("update").length).toBe(0);
  });

  test("a path through an array (positional)", async () => {
    await guardError(Wallets.updateOne({ _id: ann, "lines.qty": 1 }, { $inc: { "lines.$.qty": -2 } }));
    await guardError(Wallets.updateOne({ _id: ann }, { $inc: { "lines.0.qty": -2 } }));
    expect(t.commands.all().length).toBe(0);
  });
});
