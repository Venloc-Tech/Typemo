import { Entity, Prop, Schema, TimeoutError, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
// ---cut---
try {
  await Accounts.find().timeoutMS(100);
} catch (error) {
  if (error instanceof TimeoutError) {
    console.log(error.kind);
    // → "operation"
    console.log(error.message);
    // → operation timed out (timeoutMS): Timed out during socket read (100ms)
    console.log(error.timeoutMS);
    // → 100
  }
}
