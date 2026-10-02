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
const owner: string | undefined = process.env.OWNER;
try {
  await Accounts.find({ owner: owner as string });
} catch (error) {
  console.log((error as Error).message);
}
// → filter: undefined at "owner" (use $exists: false / $unset; undefined is never a value)
