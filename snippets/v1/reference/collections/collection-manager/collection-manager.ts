import { CollectionManager, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts", validator: true })
class Account extends Entity {
  @Prop(() => String, { required: true, minLength: 2 }) title!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.connection.model(Account);
// ---cut---
const wanted = CollectionManager.optionsOf(Accounts);
console.log(Object.keys(wanted));
// → ["validator", "validationLevel", "validationAction"]
