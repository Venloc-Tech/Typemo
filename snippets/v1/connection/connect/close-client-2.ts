import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
}
// ---cut---
{
  await using client = await TypemoClient.connect("mongodb://localhost:27017/app");
  const total = await client.connection.model(Account).countDocuments();
  console.log(total);
  // → 0
}
// the client is already closed here
