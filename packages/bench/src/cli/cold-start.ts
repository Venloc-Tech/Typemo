/*
 * One cold start for A.startup.cold: import the library, define the flat model, connect, run one findOne, close.
 * The parent process times the whole child (Bun startup is the same for every contestant).
 *
 * Usage: `bun run src/cli/cold-start.ts <driver|mongoose|typemo>`
 */
const contestant = process.argv[2];
const uri = process.env.BENCH_MONGO_URI ?? "mongodb://localhost:27117/?replicaSet=rs0&directConnection=true";

/** The cold start of each contestant. */
class ColdStart {
  /** The raw driver: connect and read once. */
  static async driver(): Promise<void> {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(uri, { maxPoolSize: 10, writeConcern: { w: 1 } });
    await client.connect();
    await client.db("typemo_bench_driver").collection("bench_flat").findOne({});
    await client.close();
  }

  /** Mongoose: define the flat model, connect and read once. */
  static async mongoose(): Promise<void> {
    const { default: mongoose } = await import("mongoose");
    const m = new mongoose.Mongoose();
    m.set("autoIndex", false);
    m.set("autoCreate", false);
    const connection = m.createConnection(uri, { maxPoolSize: 10, dbName: "typemo_bench_mongoose" });
    await connection.asPromise();
    /* Inline (the same as FLAT's schema): importing the shape module would also load Typemo. */
    const schema = new m.Schema(
      {
        name: { type: String, required: true },
        email: { type: String, required: true, unique: true },
        age: { type: Number, required: true, min: 0, max: 150, index: true },
        active: { type: Boolean, required: true },
        score: { type: Number, required: true },
      },
      { versionKey: false },
    );
    const model = connection.model("BenchFlat", schema, "bench_flat");
    await model.findOne({}).exec();
    await connection.close();
  }

  /** Typemo: define the flat model, connect and read once. */
  static async typemo(): Promise<void> {
    await import("reflect-metadata");
    const { TypemoClient } = await import("@venloc/typemo");
    const { FlatDoc } = await import("../data/shapes/flat.ts");
    const client = new TypemoClient(uri, { maxPoolSize: 10, writeConcern: { w: 1 }, dbName: "typemo_bench_typemo" });
    await client.connect();
    await client.connection.model(FlatDoc).findOne({});
    await client.close();
  }
}

/** The cold start selected on the command line. */
const run =
  contestant === "driver" ? ColdStart.driver : contestant === "mongoose" ? ColdStart.mongoose : ColdStart.typemo;
await run();
process.exit(0);
