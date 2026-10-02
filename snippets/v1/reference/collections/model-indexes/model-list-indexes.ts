import { Entity, Index, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Index({ opened: 1 }, { name: "opened_ttl", expireAfterSeconds: 3600 })
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true, index: true }) owner!: string;
  @Prop(() => Date) opened?: Date;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.connection.model(Account);
// ---cut---
console.log(await Accounts.listIndexes());
// → []

await Accounts.syncIndexes();
const indexes = await Accounts.listIndexes();
console.log(indexes.map((index) => [index.name, index.unique, index.expireAfterSeconds]));
// → [["_id_", undefined, undefined], ["title_1", true, undefined],
//    ["owner_1", undefined, undefined], ["opened_ttl", undefined, 3600]]
