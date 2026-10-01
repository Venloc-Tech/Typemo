import { MongoClient } from "mongodb";

/** Makes sure the benchmark server is a writable single-node replica set (initiates it when needed). */
export class MongoSetup {
  /**
   * The same server without `replicaSet` (so that an uninitiated node is still reachable).
   *
   * @param uri - The replica-set connection string.
   * @returns A direct-connection string.
   */
  static directUri(uri: string): string {
    const url = new URL(uri);
    url.searchParams.delete("replicaSet");
    url.searchParams.set("directConnection", "true");
    return url.toString();
  }

  /**
   * Initiates the replica set when needed and waits for a primary.
   *
   * @param uri - The replica-set connection string.
   * @param timeoutMs - How long to wait for a primary.
   * @returns The server version.
   * @throws Error - When the server is not reachable or has no primary in time.
   */
  static async ensureReplicaSet(uri: string, timeoutMs = 30_000): Promise<string> {
    const url = new URL(uri);
    const setName = url.searchParams.get("replicaSet") ?? "rs0";
    const client = new MongoClient(MongoSetup.directUri(uri), { serverSelectionTimeoutMS: 5_000 });
    try {
      await client.connect();
      const admin = client.db("admin");
      try {
        await admin.command({ replSetGetStatus: 1 });
      } catch (error) {
        const code = (error as { readonly code?: number }).code;
        /* 94 is NotYetInitialized. */
        if (code !== 94) throw error;
        await admin.command({ replSetInitiate: { _id: setName, members: [{ _id: 0, host: `localhost:27017` }] } });
      }
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hello = await admin.command({ hello: 1 });
        if (hello.isWritablePrimary === true) return String((await admin.command({ buildInfo: 1 })).version);
        if (Date.now() > deadline) throw new Error(`replica set ${setName} has no primary after ${timeoutMs} ms`);
        await Bun.sleep(200);
      }
    } catch (error) {
      throw new Error(
        `MongoDB at ${uri} is not reachable/ready (start it: packages/bench/docker/mongo.sh up): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      await client.close();
    }
  }
}
