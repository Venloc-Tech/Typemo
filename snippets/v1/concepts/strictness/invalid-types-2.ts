import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { required: true }) balance!: number;
  @Prop(() => String) status?: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/bank");
const Accounts = client.connection.model(Account);
// ---cut---
const body: unknown = JSON.parse('{ "owner": "ann", "balance": "12" }');
try {
  await Accounts.create(body as { owner: string; balance: number });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to number failed at path "balance" for "12" (string): expected a number [type]
