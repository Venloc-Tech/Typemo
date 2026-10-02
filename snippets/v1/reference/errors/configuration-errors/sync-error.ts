import { Entity, Prop, Schema, SyncError, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
await client.unsafeDriver().db("app").createCollection("logs");
// ---cut---
@Schema({ collection: "logs", capped: { size: 100_000 } })
class Log extends Entity {
  @Prop(() => String, { required: true })
  text!: string;
}
client.connection.model(Log);

try {
  await client.connection.init();
} catch (error) {
  if (error instanceof SyncError) {
    console.log(error.message);
    // → connection.init() of "app": 1 failure(s) — collection "logs": exists with options MongoDB cannot change (capped): drop the collection and create it again
    console.log(error.operation, error.report.failed);
    // → "connection.init" true
    console.log(error.failures.map((failure) => [failure.kind, failure.name, failure.model, failure.errors.map((e) => e.name)]));
    // → [["collection", "logs", "Log", ["CollectionOptionsError"]]]
    console.log(error.cause instanceof AggregateError);
    // → true
  }
}
