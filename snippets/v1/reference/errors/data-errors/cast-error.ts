import { Entity, Prop, Schema, TypemoClient, CastError } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { min: 0 }) balance?: number;
  @Prop(() => [String]) tags!: string[];
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
// ---cut---
const body = JSON.parse('{"title":"Main","owner":"alice","tags":[],"balance":"12"}');

try {
  await Accounts.create(body);
} catch (error) {
  if (error instanceof CastError) {
    console.log(error.message);
    // → Cast to number failed at path "balance" for "12" (string): expected a number [type]
    console.log(error.path, error.expected, error.reason);
    // → "balance" "number" "type"
  }
}
