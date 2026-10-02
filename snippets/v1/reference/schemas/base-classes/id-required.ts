import { EntityWithId, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
@Schema({ collection: "countries" })
class Country extends EntityWithId(() => String) {
  @Prop(() => String, { required: true })
  name!: string;
}
const Countries = client.db().model(Country);
// ---cut---
// @errors: 2769
try {
  await Countries.create({ name: "Nowhere" });
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "_id": the field is required [required]
