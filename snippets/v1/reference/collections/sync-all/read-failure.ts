import { Entity, Prop, Schema, SyncError, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const connection = client.connection;
connection.model(Account);
// ---cut---
try {
  await connection.syncAll();
} catch (error) {
  if (error instanceof SyncError) {
    for (const failure of error.failures) console.error(failure.name, failure.errors.map((e) => e.message));
    throw new Error(`database sync failed: ${error.errors.length} problem(s)`, { cause: error });
  }
  throw error;
}
