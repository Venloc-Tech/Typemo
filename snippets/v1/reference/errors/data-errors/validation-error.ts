import { Entity, Prop, Schema, TypemoClient, ValidationError } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { min: 0 }) balance?: number;
  @Prop(() => String, { enum: ["open", "frozen"] }) status?: "open" | "frozen";
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
// ---cut---
const body = JSON.parse('{"title":"Main","balance":-5,"status":"gone"}');

try {
  await Accounts.create(body);
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.message);
    // → Validation failed: "owner": the field is required [required]; "balance": must be at least 0 [min]; "status": must be one of "open", "frozen" [enum]
    console.log(Object.keys(error.errors));
    // → ["owner", "balance", "status"]
  }
}
