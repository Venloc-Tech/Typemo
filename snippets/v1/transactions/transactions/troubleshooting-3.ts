import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
// ---cut---
const outside = await Accounts.findOne({ title: "Main" }).orFail();

// wrong: the object is loaded outside, on retry the subtraction is applied twice
await client.transaction(async () => {
  outside.balance = outside.balance - 10;
  await outside.$save();
});

// right: the document is read inside, every attempt starts from the value in the database
await client.transaction(async () => {
  const inside = await Accounts.findOne({ title: "Main" }).orFail();
  inside.balance = inside.balance - 10;
  await inside.$save();
});
