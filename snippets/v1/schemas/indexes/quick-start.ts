import { Entity, Index, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Index({ owner: 1, opened: -1 }) // [!code ++]
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) // [!code highlight]
  number!: string;
  @Prop(() => String, { index: true }) // [!code highlight]
  owner?: string;
  @Prop(() => Date)
  opened?: Date;
}

const Accounts = client.db().model(Account);
const report = await client.connection.init();
console.log(report.created);
// → ["collection accounts", "index accounts.number_1", "index accounts.owner_1", "index accounts.owner_1_opened_-1"]
