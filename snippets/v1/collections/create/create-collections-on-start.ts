import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts", validator: true })
class Account extends Entity {
  @Prop(() => String, { required: true, minLength: 2 }) title!: string;
  @Prop(() => Number, { min: 0 }) balance?: number;
}
@Schema({ collection: "ledger", capped: { size: 65_536, max: 100 } })
class LedgerEntry extends Entity {
  @Prop(() => String, { required: true }) note!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
export const prepareDatabase = async () => {
  client.connection.model(Account);
  client.connection.model(LedgerEntry);
  const report = await client.connection.init();
  console.log(report.collections.map((c) => [c.collection, c.options?.result]));
  // → [["accounts", "created"], ["ledger", "created"]]
};
