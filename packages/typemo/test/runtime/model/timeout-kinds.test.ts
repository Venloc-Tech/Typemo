/*
 * `TimeoutError` names where the time ran out and carries the exceeded limit for every kind: an
 * operation's `timeoutMS` gives kind `operation`, a transaction's `timeoutMS` gives kind `transaction`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { type FailPointHandle, FailPointHelpers } from "@venloc/typemo-test-kit";
import { TimeoutError } from "../../../src/index.ts";
import { Counter } from "../../fixtures/model/model-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("timeout_kinds");
let failpoint: FailPointHandle | undefined;

afterEach(async () => {
  await failpoint?.disable();
  failpoint = undefined;
});

describe("TimeoutError kind and timeoutMS", () => {
  test("an operation's timeoutMS → kind operation, timeoutMS filled", async () => {
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
    expect((error as TimeoutError).timeoutMS).toBe(100);
    expect((error as TimeoutError).cause).toBeDefined();
  });

  test("a transaction's timeoutMS runs out → kind transaction, timeoutMS filled", async () => {
    const Counters = t.connection.model(Counter);
    await Counters.create({ key: "c", value: 1 });
    failpoint = await FailPointHelpers.configureFailCommand(t.mongo.client, {
      failCommands: ["find"],
      blockConnection: true,
      blockTimeMS: 400,
      times: 1,
    });
    const error = await t.connection
      .transaction(
        async () => {
          await Counters.find();
        },
        { timeoutMS: 200 },
      )
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as TimeoutError).kind).toBe("transaction");
    expect((error as TimeoutError).timeoutMS).toBe(200);
    expect((error as TimeoutError).cause).toBeDefined();
  });
});
