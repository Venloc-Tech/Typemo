import { EntityWithId, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "blog" });
// ---cut---
@Schema({ collection: "countries" })
export class Country extends EntityWithId(() => String) {
  @Prop(() => String, { required: true })
  name!: string;
}

const Countries = client.db().model(Country);
const france = await Countries.findById("FR").orFail().lean();
console.log(france._id);
// → FR
