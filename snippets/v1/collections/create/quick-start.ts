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
const connection = client.connection;
const Accounts = connection.model(Account);
const Ledger = connection.model(LedgerEntry);
// ---cut---
await connection.init(); // every model of the connection
await Accounts.createCollection(); // one model: true if it created it
await Ledger.ensureCollection(); // one model: creates, checks or updates
