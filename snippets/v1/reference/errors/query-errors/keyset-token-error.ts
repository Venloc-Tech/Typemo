import { Entity, KeysetTokenError, Prop, Schema, TypemoClient, Versioned } from "@venloc/typemo";
@Schema({ collection: "accounts", optimisticConcurrency: true })
class Account extends Versioned(Entity) {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
// ---cut---
try {
  await Accounts.keysetPage({ sort: [["title", "asc"]], limit: 20, after: "garbage" });
} catch (error) {
  if (error instanceof KeysetTokenError) {
    console.log(error.message);
    // → keysetPage: invalid cursor — it cannot be read
    console.log(error.path);
    // → "after"
  }
}
