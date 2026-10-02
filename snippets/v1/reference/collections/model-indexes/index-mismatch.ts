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
const raw = client.unsafeDriver().db("app").collection("accounts");
await Accounts.syncIndexes();
await raw.dropIndex("owner_1");
await raw.createIndex({ owner: 1 }, { name: "owner_1", unique: true });
// ---cut---
console.log(await Accounts.diffIndexes());
// → { toCreate: ["owner_1"], toDrop: ["owner_1"], toModify: [] }
