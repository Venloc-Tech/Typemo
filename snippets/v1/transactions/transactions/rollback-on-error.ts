import { DuplicateKeyError, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
await client.connection.init();
// ---cut---
try {
  await client.transaction(async () => {
    await Accounts.updateOne({ title: "Main" }, { $inc: { balance: -1 } });
    await Accounts.create({ title: "Main", balance: 1 });
  });
} catch (error) {
  if (error instanceof DuplicateKeyError) console.log("rolled back");
  // → "rolled back"
}
