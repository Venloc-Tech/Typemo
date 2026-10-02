import { EntityWithId, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
@Schema({ collection: "countries" })
class Country extends EntityWithId(() => String) {
  @Prop(() => String, { required: true }) name!: string;
}
const Countries = client.db().model(Country);
// ---cut---
await Countries.create({ _id: "IT", name: "Italy" });

const found = await Countries.findById("IT").orFail().lean();
console.log(found);
// → { _id: "IT", name: "Italy" }

const missing = await Countries.findById("DE");
console.log(missing);
// → null
