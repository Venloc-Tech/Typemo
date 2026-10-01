// A `TypemoClient` per test file on the shared mongod (test-kit's `MongoLifecycle` gives the database and
// its cleanup; this adds the Typemo client, mirroring `packages/typemo/test/fixtures/model/model-lifecycle.ts`
// — duplicated here rather than imported: it is not part of `@venloc/typemo-test-kit`'s public API).
import { afterAll, beforeAll } from "bun:test";
import { BsonOptions, type Connection, TypemoClient, type TypemoClientOptions } from "@venloc/typemo";
import { MongoHarness, MongoLifecycle, type MongoTestContext } from "@venloc/typemo-test-kit";

export interface TypemoTestContext {
  readonly mongo: MongoTestContext;
  readonly client: TypemoClient;
  readonly connection: Connection;
}

export class TypemoLifecycle {
  static useTypemo(prefix: string, options: TypemoClientOptions = {}): TypemoTestContext {
    const mongo = MongoLifecycle.useMongo(prefix, BsonOptions.apply({}));
    let client: TypemoClient | undefined;

    beforeAll(async () => {
      client = new TypemoClient(MongoHarness.getUri(), { dbName: mongo.dbName, ...options });
      await client.connect();
    });
    afterAll(async () => {
      await client?.close();
    });

    const need = <T>(value: T | undefined): T => {
      if (value === undefined) throw new Error("the Typemo client exists only inside tests and hooks");
      return value;
    };
    return {
      mongo,
      get client() {
        return need(client);
      },
      get connection() {
        return need(client).connection;
      },
    };
  }
}
