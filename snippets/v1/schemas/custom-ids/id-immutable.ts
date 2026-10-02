import { EntityWithId, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
@Schema({ collection: "countries" })
class Country extends EntityWithId(() => String) {
  @Prop(() => String, { required: true }) name!: string;
}
const Countries = client.db().model(Country);
// ---cut---
try {
  await Countries.updateOne({ _id: "FR" }, { $set: { _id: "XX" } } as never);
} catch (error) {
  console.log((error as Error).message);
}
// → $set._id: "_id" is immutable; it is written only when the document is created ($setOnInsert on upsert) [immutable]
