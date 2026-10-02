import { Entity, Index, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Index({ email: 1 }, { unique: true, partialFilterExpression: { active: true }, name: "email_active" }) // [!code highlight]
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String) email?: string;
  @Prop(() => Boolean) active?: boolean;
}

const Accounts = client.db().model(Account);
await client.connection.init();
await Accounts.create({ email: "a@x", active: true });
const inactive = await Accounts.create({ email: "a@x", active: false });
// a closed account with the same email was written: the index does not see it

try {
  await Accounts.create({ email: "a@x", active: true });
} catch (error) {
  console.log((error as Error).message);
}
// → duplicate key on email_active: { email: "a@x" } (code 11000 DuplicateKey)
