import { ConfigurationError, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
// ---cut---
try {
  await client.transaction(async () => {
    await client.transaction(async () => {});
  });
} catch (error) {
  if (error instanceof ConfigurationError) console.log(error.message);
  // → transaction(): transactions do not nest (already inside a transaction of this client)
}
