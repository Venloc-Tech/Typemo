/* On the real server: server failures reach the caller as Typemo errors (class, code, cause). */
import { afterEach, describe, expect, test } from "bun:test";
import { type FailPointHandle, FailPointHelpers } from "@venloc/typemo-test-kit";
import {
  DuplicateKeyError,
  ServerError,
  ServerValidationError,
  TimeoutError,
  WriteConflictError,
} from "../../../src/index.ts";
import { Counter } from "../../fixtures/model/model-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("errors");
let failpoint: FailPointHandle | undefined;

afterEach(async () => {
  await failpoint?.disable();
  failpoint = undefined;
});

describe("server errors as Typemo errors", () => {
  test("121: the collection validator refuses → ServerValidationError with errInfo", async () => {
    await t.mongo.db.createCollection("m_counters", {
      validator: { $jsonSchema: { bsonType: "object", properties: { value: { bsonType: "int", minimum: 0 } } } },
    });
    const error = await t.connection
      .model(Counter)
      .create({ key: "k", value: -5 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ServerValidationError);
    const validation = error as ServerValidationError;
    expect(validation.code).toBe(121);
    expect(validation.errInfo).toHaveProperty("details");
    expect((validation.cause as Error).name).toBe("MongoServerError");
    await t.mongo.db.collection("m_counters").drop();
  });

  test("112 outside a transaction → WriteConflictError", async () => {
    failpoint = await FailPointHelpers.configureFailCommand(t.mongo.client, {
      failCommands: ["update"],
      errorCode: 112,
      times: 1,
    });
    const error = await t.connection
      .model(Counter)
      .updateOne({ key: "k" }, { $set: { value: 1 } })
      .exec()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WriteConflictError);
    expect((error as WriteConflictError).code).toBe(112);
  });

  test("timeoutMS (CSOT) elapsed → TimeoutError(operation) with the driver error as cause", async () => {
    failpoint = await FailPointHelpers.configureFailCommand(t.mongo.client, {
      failCommands: ["find"],
      blockConnection: true,
      blockTimeMS: 400,
      times: 1,
    });
    const error = await t.connection
      .model(Counter)
      .find()
      .timeoutMS(100)
      .exec()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as TimeoutError).kind).toBe("operation");
    expect((error as TimeoutError).cause).toBeDefined();
  });
});

describe("ServerError texts", () => {
  test("the message is the server's reason and the code; the full text stays in serverMessage and cause", async () => {
    const Counters = t.connection.model(Counter);
    await Counters.create({ key: "hint", value: 1 });
    const error = await Counters.find({ key: "hint" })
      .hint("nope_1")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ServerError);
    const server = error as ServerError;
    expect(server.message).not.toContain("ns=");
    expect(server.message).toContain(`(code ${server.code}`);
    /* MongoDB 9.0 wraps the reason in "ns=… :: caused by ::"; 8.3 sends the bare reason, so no length check. */
    expect(server.message).not.toContain(":: caused by ::");
    expect(server.serverMessage).toBe((server.cause as Error).message);
    expect(server.serverMessage).toContain(server.message.slice(0, 20));
  });

  test("codeName is filled from the table of codes when the server leaves it out (11000)", async () => {
    const Counters = t.connection.model(Counter);
    await t.mongo.db.collection("m_counters").createIndex({ key: 1 }, { unique: true });
    await Counters.create({ key: "dup", value: 1 });
    const error = await Counters.create({ key: "dup", value: 2 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DuplicateKeyError);
    expect((error as DuplicateKeyError).codeName).toBe("DuplicateKey");
    await t.mongo.db.collection("m_counters").drop();
  });
});
