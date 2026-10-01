/*
 * What the server stores for each collection option (listCollections), what
 * `collMod` can change, how index collation/hidden are reported, and what a plain mongod says about
 * search indexes.
 *
 * Usage (from packages/typemo): `bun run test/experiments/s9-collection-options.ts` (upcoming) and
 *        `TYPEMO_MONGO=stable bun run test/experiments/s9-collection-options.ts`.
 */
import { MongoHarness } from "@venloc/typemo-test-kit";
import { type Db, MongoClient } from "mongodb";

const show = (label: string, value: unknown): void => {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = `<${(value as object)?.constructor?.name ?? typeof value}>`;
  }
  console.log(`${label}: ${text}`);
};
const err = (error: unknown): string => {
  const e = error as { code?: number; codeName?: string; message?: string };
  return `${e.code} ${e.codeName}: ${String(e.message).slice(0, 160)}`;
};

class Probe {
  static async info(db: Db, name: string) {
    return (await db.listCollections({ name }).toArray())[0] as { type?: string; options?: unknown } | undefined;
  }

  static async attempt(label: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      show(label, await fn());
    } catch (error) {
      console.log(`${label}: ERROR ${err(error)}`);
    }
  }
}

await MongoHarness.ensureStarted();
const client = new MongoClient(MongoHarness.getUri());
await client.connect();
const db = client.db("s9probe");
await db.dropDatabase();
console.log("server", (await db.admin().serverInfo()).version);

await db.createCollection("capped", { capped: true, size: 4096, max: 10 });
show("capped", await Probe.info(db, "capped"));
await Probe.attempt("collMod cappedSize/cappedMax", () =>
  db.command({ collMod: "capped", cappedSize: 8192, cappedMax: 20 }),
);
show("capped after", await Probe.info(db, "capped"));

await db.createCollection("ts", {
  timeseries: { timeField: "at", metaField: "meta", granularity: "seconds" },
  expireAfterSeconds: 60,
});
show("timeseries", await Probe.info(db, "ts"));
await Probe.attempt("collMod granularity minutes", () =>
  db.command({ collMod: "ts", timeseries: { granularity: "minutes" } }),
);
await Probe.attempt("collMod expireAfterSeconds", () => db.command({ collMod: "ts", expireAfterSeconds: 120 }));
show("timeseries after", await Probe.info(db, "ts"));
await Probe.attempt("ts bucket unequal", () =>
  db.createCollection("ts2", { timeseries: { timeField: "at", bucketMaxSpanSeconds: 100, bucketRoundingSeconds: 50 } }),
);
await Probe.attempt("ts bucket one only", () =>
  db.createCollection("ts3", { timeseries: { timeField: "at", bucketMaxSpanSeconds: 100 } }),
);
await Probe.attempt("ts bucket equal", () =>
  db.createCollection("ts4", {
    timeseries: { timeField: "at", bucketMaxSpanSeconds: 100, bucketRoundingSeconds: 100 },
  }),
);
show("ts4", await Probe.info(db, "ts4"));

await db.createCollection("clustered", {
  clusteredIndex: { key: { _id: 1 }, unique: true, name: "by_id" },
  expireAfterSeconds: 30,
});
show("clustered", await Probe.info(db, "clustered"));
await Probe.attempt("clustered no name", () =>
  db.createCollection("clustered2", { clusteredIndex: { key: { _id: 1 }, unique: true } }),
);
show("clustered2", await Probe.info(db, "clustered2"));
await Probe.attempt("clustered + capped", () =>
  db.createCollection("cc", { clusteredIndex: { key: { _id: 1 }, unique: true }, capped: true, size: 4096 }),
);
await Probe.attempt("expireAfterSeconds plain", () => db.createCollection("ttlplain", { expireAfterSeconds: 10 }));
show("listIndexes clustered", await db.collection("clustered").listIndexes().toArray());

await db.createCollection("val", {
  validator: { $jsonSchema: { bsonType: "object", required: ["a"], properties: { a: { bsonType: "int" } } } },
  validationLevel: "strict",
  validationAction: "error",
  collation: { locale: "en", strength: 2 },
  changeStreamPreAndPostImages: { enabled: true },
});
show("val", await Probe.info(db, "val"));
await Probe.attempt("collMod validator", () =>
  db.command({ collMod: "val", validator: { $jsonSchema: { bsonType: "object" } }, validationLevel: "moderate" }),
);
await Probe.attempt("collMod pre/post off", () =>
  db.command({ collMod: "val", changeStreamPreAndPostImages: { enabled: false } }),
);
show("val after", await Probe.info(db, "val"));
await Probe.attempt("collMod collation", () => db.command({ collMod: "val", collation: { locale: "fr" } }));
show("indexes of val (default collation)", await db.collection("val").listIndexes().toArray());
await db.collection("val").createIndex({ a: 1 });
await db.collection("val").createIndex({ b: 1 }, { collation: { locale: "simple" } });
show("indexes of val after", await db.collection("val").listIndexes().toArray());

await db.createCollection("plain");
await db.collection("plain").createIndex({ x: 1 }, { collation: { locale: "en" } });
await db.collection("plain").createIndex({ y: 1 }, { collation: { locale: "fr_CA" } });
await db.collection("plain").createIndex({ z: 1 }, { unique: false, sparse: false });
await db.collection("plain").createIndex({ w: 1 }, { hidden: true });
show("indexes plain", await db.collection("plain").listIndexes().toArray());
await Probe.attempt("collMod unhide", () => db.command({ collMod: "plain", index: { name: "w_1", hidden: false } }));
show(
  "indexes plain after unhide",
  (await db.collection("plain").listIndexes().toArray()).find((i) => i.name === "w_1"),
);
await Probe.attempt("collMod hide by keyPattern", () =>
  db.command({ collMod: "plain", index: { keyPattern: { x: 1 }, hidden: true } }),
);
await db.collection("plain").createIndex({ at: 1 }, { expireAfterSeconds: 10 });
await Probe.attempt("collMod index ttl", () =>
  db.command({ collMod: "plain", index: { name: "at_1", expireAfterSeconds: 20 } }),
);
show("indexes plain end", await db.collection("plain").listIndexes().toArray());

await Probe.attempt("listSearchIndexes", () => db.collection("plain").listSearchIndexes().toArray());
await Probe.attempt("createSearchIndex", () =>
  db.collection("plain").createSearchIndex({ name: "s", definition: { mappings: { dynamic: true } } }),
);

await db.createCollection("v", { viewOn: "plain", pipeline: [{ $match: { x: 1 } }] });
show("view", await Probe.info(db, "v"));
await Probe.attempt("create existing plain", () => db.createCollection("plain"));
await Probe.attempt("create existing with other options", () =>
  db.createCollection("plain", { capped: true, size: 4096 }),
);
await Probe.attempt("create existing view as collection", () => db.createCollection("v"));

await db.dropDatabase();
await client.close();
await MongoHarness.stop();
