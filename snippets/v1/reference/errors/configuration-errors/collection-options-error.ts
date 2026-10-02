import { CollectionOptionsError, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
// ---cut---
@Schema({ collection: "logs", capped: { size: 100_000 } })
class Log extends Entity {
  @Prop(() => String, { required: true })
  text!: string;
}
const Logs = client.connection.model(Log);

try {
  await Logs.createCollection();
} catch (error) {
  if (error instanceof CollectionOptionsError) {
    console.log(error.message);
    // → collection "logs": exists with options MongoDB cannot change (capped): drop the collection and create it again
    console.log(error.collection, error.differences);
    // → "logs" [{ option: "capped", mutable: false, wanted: true }]
  }
}
