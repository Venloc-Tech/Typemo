/*
 * The runtime smoke: the compiled JavaScript of this file runs under Node against the BUILT packages and a real
 * MongoDB (`MONGO_URI`). It prints one JSON object of results for the suite to compare.
 */
import {
  CastError,
  fn,
  Pipeline,
  PolicyContext,
  QueryError,
  StrictModeError,
  TypemoClient,
  ValidationError,
} from "@venloc/typemo";
import { defineFactory } from "@venloc/typemo/testing";
import { TypemoOpenTelemetry } from "@venloc/typemo-opentelemetry";
import { TypemoSentry } from "@venloc/typemo-sentry";
import { Circle, Country, Note, Order, Region, Shape, User } from "./entities.js";

const uri = process.env.MONGO_URI;
if (uri === undefined) throw new Error("MONGO_URI is not set");
const client = await TypemoClient.connect(uri, { dbName: process.env.MONGO_DB ?? "dist_consumer" });
const out: Record<string, unknown> = {};
/* The integrations subscribe to the client; the events of everything below flow through them. */
const subscriptions = [TypemoOpenTelemetry.instrument(client), TypemoSentry.instrument(client)];
try {
  const Users = client.connection.model(User);
  const Regions = client.connection.model(Region);
  const Orders = client.connection.model(Order);
  const Countries = client.connection.model(Country);
  const Notes = client.connection.model(Note);
  const Shapes = client.connection.model(Shape);
  const Circles = client.connection.model(Circle);
  await client.connection.init();

  const region = await Regions.create({ name: "emea" });
  const ann = await Users.create({ name: "Ann", email: "ANN@X.io", tags: ["a", "b"], region: region._id as never });
  out.created = {
    email: ann.email,
    label: ann.label(),
    hasTimestamps: ann.createdAt instanceof Date,
    tags: [...ann.tags],
  };
  out.lean = await Users.find({ tags: "a" }).select({ name: 1, _id: 0 }).lean();
  const populated = await Users.findOne({ name: "Ann" }).populate("region").orFail().lean();
  out.populated = populated.region?.name;
  await Users.updateOne({ name: "Ann" }, { $inc: { age: 1 } });
  out.afterUpdate = (await Users.findOne({ name: "Ann" }).orFail().lean()).age;

  await Orders.insertMany([
    { status: "paid", amount: 10 },
    { status: "paid", amount: 5 },
    { status: "open", amount: 7 },
  ]);
  out.rows = await Orders.aggregate((p) =>
    p.group((f) => ({ _id: f.status, total: fn.sum(f.amount) })).sort({ _id: 1 }),
  ).plain();
  out.plan = Pipeline.from(Order).match({ status: "paid" }).plan().pipeline;

  await Countries.create({ _id: "FR", name: "France" });
  out.country = (await Countries.findById("FR").orFail().lean()).name;

  const tenantNote = await PolicyContext.run({ tenant: "acme" }, () => Notes.create({ text: "hi" }));
  out.tenant = tenantNote.tenantId;
  out.tenantVisible = await PolicyContext.run({ tenant: "other" }, () => Notes.countDocuments({}));

  await Circles.create({ radius: 3 });
  out.shapes = (await Shapes.find().lean()).map((row) => (row as { __t?: string }).__t);

  const factory = defineFactory(Users, (n) => ({ name: `F${n}`, email: `f${n}@x.io`, tags: [] }));
  out.factory = factory.build().name;

  const errors: Record<string, string> = {};
  for (const [name, run] of [
    ["validation", () => Users.create({ name: "x" } as never)],
    ["cast", () => Promise.resolve(Users.find({ age: "abc" } as never))],
    ["strict", () => Promise.resolve(Users.find({ nope: 1 } as never))],
  ] as const) {
    try {
      await run();
      errors[name] = "no error";
    } catch (error) {
      errors[name] =
        error instanceof ValidationError
          ? "ValidationError"
          : error instanceof CastError
            ? "CastError"
            : error instanceof StrictModeError
              ? "StrictModeError"
              : error instanceof QueryError
                ? "QueryError"
                : String(error);
    }
  }
  out.errors = errors;

  await client.transaction(async () => {
    await Regions.create({ name: "tx" });
  });
  out.transaction = await Regions.countDocuments({ name: "tx" });
  for (const subscription of subscriptions) subscription.unsubscribe();
  out.integrations = subscriptions.length;
} finally {
  await client.close();
}
console.log(`RESULT ${JSON.stringify(out)}`);
