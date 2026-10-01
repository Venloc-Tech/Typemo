/*
 * On the real server: an error names the method the user called, never the internal operation it runs as —
 * `create([...])` is not `bulkWrite`, `create` is not `save`/`insertOne`, `findById` is not `findOne`, an
 * aggregation with `$out` is not `updateMany`, and `$save()` of a deleted document does not mention `orFail`.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import {
  BulkWriteError,
  DocumentNotFoundError,
  DuplicateKeyError,
  Entity,
  type Model,
  PolicyContext,
  Prop,
  QueryError,
  Schema,
  StrictModeError,
} from "../../../src/index.ts";
import { OrgDoc } from "../../fixtures/mechanisms/mechanism-entities.ts";
import { Person } from "../../fixtures/model/model-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** An account with a unique email (the index is created by the test). */
@Schema({ collection: "cm_accounts" })
class CmAccount extends Entity {
  @Prop(() => String, { required: true })
  email!: string;
}

const t = ModelLifecycle.useTypemo("called_method");
let Accounts: Model<CmAccount>;
let People: Model<Person>;
let Docs: Model<OrgDoc>;

beforeEach(async () => {
  Accounts = t.connection.model(CmAccount);
  People = t.connection.model(Person);
  Docs = t.connection.model(OrgDoc);
  await t.mongo.db.collection("cm_accounts").createIndex({ email: 1 }, { unique: true });
});

/**
 * The error `run` rejects with.
 * @param run - Starts the operation.
 * @returns What it rejected with, or `undefined` when it resolved.
 */
const errorOf = async (run: () => PromiseLike<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe("writes name the method that was called", () => {
  test("create([...]) with a duplicate: the BulkWriteError names CmAccount.create, not bulkWrite", async () => {
    await Accounts.create({ email: "a@x.test" });
    const error = await errorOf(() => Accounts.create([{ email: "b@x.test" }, { email: "a@x.test" }]));
    expect(error).toBeInstanceOf(BulkWriteError);
    expect((error as Error).message).toStartWith("CmAccount.create: ");
    expect((error as Error).message).not.toContain("bulkWrite");
    expect((error as BulkWriteError).writeErrors[0]?.error).toBeInstanceOf(DuplicateKeyError);
  });

  test("create(doc) with a duplicate: DuplicateKeyError (one document, one error)", async () => {
    await Accounts.create({ email: "a@x.test" });
    expect(await errorOf(() => Accounts.create({ email: "a@x.test" }))).toBeInstanceOf(DuplicateKeyError);
  });

  test("create without a tenant and with another tenant: the tenant error names create", async () => {
    const missing = await errorOf(() => Docs.create({ body: "x" }));
    expect(missing).toBeInstanceOf(StrictModeError);
    expect((missing as Error).message).toStartWith("OrgDoc.create: ");
    const other = new ObjectId();
    const foreign = await errorOf(() =>
      PolicyContext.run({ tenant: new ObjectId().toHexString() }, () => Docs.create({ org: other, body: "x" })),
    );
    expect(foreign).toBeInstanceOf(StrictModeError);
    expect((foreign as Error).message).toStartWith("OrgDoc.create: ");
  });

  test("insertOne and insertMany without a tenant name themselves", async () => {
    expect(((await errorOf(() => Docs.insertOne({ body: "x" }))) as Error).message).toStartWith("OrgDoc.insertOne: ");
    expect(((await errorOf(() => Docs.insertMany([{ body: "x" }]))) as Error).message).toContain("OrgDoc.insertMany");
  });
});

describe("reads name the method that was called", () => {
  test("findById(...).orFail() on no document: DocumentNotFoundError of findById", async () => {
    const error = await errorOf(() => People.findById(new ObjectId()).orFail());
    expect(error).toBeInstanceOf(DocumentNotFoundError);
    expect((error as DocumentNotFoundError).operation).toBe("findById");
    expect((error as Error).message).toBe("Person.findById: no document matched the filter (orFail)");
  });

  test("findByIdAndUpdate / findByIdAndDelete with orFail name themselves", async () => {
    const updated = await errorOf(() => People.findByIdAndUpdate(new ObjectId(), { $set: { name: "x" } }).orFail());
    expect((updated as DocumentNotFoundError).operation).toBe("findByIdAndUpdate");
    const deleted = await errorOf(() => People.findByIdAndDelete(new ObjectId()).orFail());
    expect((deleted as DocumentNotFoundError).operation).toBe("findByIdAndDelete");
  });

  test("a second await of an aggregation with $out names aggregate, not updateMany", async () => {
    const out = People.aggregate((p) => p.match({}).out("cm_people_copy"));
    await out;
    const error = await errorOf(() => out.exec());
    expect(error).toBeInstanceOf(QueryError);
    expect((error as Error).message).toStartWith("aggregate: this operation was already executed");
    expect((error as Error).message).not.toContain("updateMany");
  });
});

describe("$save() of a deleted document", () => {
  test("DocumentNotFoundError of save, without a word about orFail", async () => {
    const person = await People.create({ name: "Ann", email: "ann@x.test", tags: [], pets: [], lastSeen: null });
    await People.deleteOne({ _id: person._id });
    person.name = "Anna";
    const error = await errorOf(() => person.$save());
    expect(error).toBeInstanceOf(DocumentNotFoundError);
    expect((error as DocumentNotFoundError).operation).toBe("save");
    expect((error as Error).message).not.toContain("orFail");
    expect((error as Error).message).toStartWith("Person.save: ");
  });
});
