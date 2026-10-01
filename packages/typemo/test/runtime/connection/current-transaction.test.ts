/*
 * `client.currentTransaction()` and `TransactionScope.current()` (decision R65): whether the current async context
 * runs inside a transaction, of this client or of any — read-only, no transaction is started or joined by asking.
 */
import { expect, test } from "bun:test";
import { MongoHarness } from "@venloc/typemo-test-kit";
import { TransactionScope, TypemoClient } from "../../../src/index.ts";
import { Person } from "../../fixtures/model/model-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("curtxn");

test("outside a transaction both are undefined", () => {
  expect(t.client.currentTransaction()).toBeUndefined();
  expect(TransactionScope.current()).toBeUndefined();
});

test("inside: the scope of the callback, also after awaits and in called functions", async () => {
  await t.connection.model(Person).createCollection();
  const read = async (): Promise<TransactionScope | undefined> => {
    await Promise.resolve();
    return t.client.currentTransaction();
  };
  await t.client.transaction(async (scope) => {
    expect(t.client.currentTransaction()).toBe(scope);
    expect(TransactionScope.current()).toBe(scope);
    await t.connection.model(Person).countDocuments({ name: "x" });
    expect(await read()).toBe(scope);
    expect(scope.owner).toBe(t.client);
  });
  expect(t.client.currentTransaction()).toBeUndefined();
});

test("inside a transaction of another client: this client's is undefined, the ambient one is the other's", async () => {
  const other = await TypemoClient.connect(MongoHarness.getUri(), { dbName: t.mongo.dbName });
  try {
    await other.transaction(async (scope) => {
      expect(t.client.currentTransaction()).toBeUndefined();
      expect(other.currentTransaction()).toBe(scope);
      expect(TransactionScope.current()?.owner).toBe(other);
    });
  } finally {
    await other.close();
  }
});

test("asking starts nothing: no session, no command", async () => {
  t.commands.clear();
  t.client.currentTransaction();
  TransactionScope.current();
  expect(t.commands.all()).toEqual([]);
});
