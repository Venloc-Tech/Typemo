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
const result = await Accounts.syncIndexes();
console.log(result.toCreate, result.dryRun);
// → ["title_1", "owner_1", "opened_ttl"] false
