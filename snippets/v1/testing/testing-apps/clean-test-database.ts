import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { Filters, TypemoClient } from "@venloc/typemo";
import { Account } from "./account.ts";

let client: TypemoClient;

beforeAll(async () => {
  client = await TypemoClient.connect(process.env.TEST_MONGO_URI ?? "mongodb://localhost:27017", { dbName: "bank-test" });
  await client.db().model(Account).syncIndexes();
});

beforeEach(async () => {
  await client.db().model(Account).deleteMany(Filters.all());
});

afterAll(async () => {
  await client.close();
});
