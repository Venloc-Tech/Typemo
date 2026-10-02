import { EntityWithId, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "countries" })
class Country extends EntityWithId(() => String) { // [!code highlight]
  @Prop(() => String, { required: true })
  name!: string;
}
const Countries = client.db().model(Country);
const france = await Countries.create({ _id: "FR", name: "France" });
const found = await Countries.findById("FR").orFail();
console.log(france._id, found.name);
// → FR France
