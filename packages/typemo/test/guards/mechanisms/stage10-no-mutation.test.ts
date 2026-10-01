/*
 * The no-mutation sweep over the public inputs the other guards do not cover — populate specs (with
 * match/select/options/nested populate), policy values (`PolicyContext.run`, `.policy()`), transaction options,
 * `watch({ include })`, `keysetSecret`, an audited write with its write concern moved to the transaction,
 * `untrusted`. Every input is deeply frozen and compared after.
 */
import { describe, expect, test } from "bun:test";
import { Freeze } from "@venloc/typemo-test-kit";
import { PolicyContext, TypemoClient, untrusted } from "../../../src/index.ts";
import { Note, Payment } from "../../fixtures/mechanisms/mechanism-entities.ts";
import { Animal } from "../../fixtures/mechanisms/storage-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";
import { P, seedPopulate } from "../../fixtures/populate/populate-seed.ts";

const t = ModelLifecycle.useTypemo("m10_nomut");

/** Runs `use` with a deeply frozen `input` and checks that `input` is unchanged afterwards. */
const unchanged = async <T>(input: T, use: (frozen: T) => unknown): Promise<void> => {
  const frozen = Freeze.deep(input);
  const before = Freeze.snapshot(frozen);
  await use(frozen);
  expect(Freeze.snapshot(frozen)).toBe(before);
};

describe("no input mutation (public inputs sweep)", () => {
  test("populate specs: select, match, options, nested populate, required", async () => {
    const m = await seedPopulate(t);
    await unchanged(
      {
        path: "friends" as const,
        select: { name: 1 as const },
        match: { name: { $ne: "nobody" } },
        options: { sort: { name: 1 as const }, limit: 5 },
        populate: { path: "company" as const },
      },
      (spec) => m.People.findById(P.ann).populate(spec).orFail(),
    );
    await unchanged({ path: "company" as const, required: true as const }, (spec) =>
      m.People.findById(P.ann).populate(spec).orFail().lean(),
    );
  });

  test("policy values: PolicyContext.run and .policy()", async () => {
    const Notes = t.connection.model(Note);
    await unchanged({ tenant: "t1", actor: { id: "u1", roles: ["admin"] } }, (values) =>
      PolicyContext.run(values, () => Notes.create({ title: "p" })),
    );
    await unchanged({ tenant: "t1" }, (values) => Notes.find({ title: "p" }).policy(values).lean());
  });

  test("transaction options; an audited write whose write concern goes to its own transaction", async () => {
    await unchanged({ readConcern: "snapshot" as const, writeConcern: { w: "majority" as const } }, (options) =>
      t.connection.transaction(async () => undefined, options),
    );
    const Payments = t.connection.model(Payment);
    await unchanged([{ amount: 1 }, { amount: 2 }], (docs) => Payments.insertMany(docs));
    await unchanged({ w: "majority" as const }, (concern) =>
      Payments.updateMany({ amount: { $gte: 0 } }, { $inc: { amount: 1 } })
        .writeConcern(concern)
        .exec(),
    );
  });

  test("watch include, keysetSecret, untrusted", async () => {
    const Animals = t.connection.model(Animal);
    await Animals.ensureCollection();
    await unchanged({ include: ["secret" as const], fullDocument: "updateLookup" as const }, async (options) => {
      const stream = await Animals.watch(options);
      await stream.close();
    });
    await unchanged(["k".repeat(32), "o".repeat(32)], (keysetSecret) => {
      new TypemoClient("mongodb://localhost", { keysetSecret });
    });
    await unchanged({ name: "ann" }, (value) => untrusted(value));
  });
});
