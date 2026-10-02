import { ConfigurationError, Entity, Prop, Schema, TypedView, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Boolean, { required: true }) closed!: boolean;
}
@Schema({ collection: "open_accounts" })
class OpenAccount extends Entity {
  @Prop(() => String, { required: true }) title!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const connection = client.connection;
connection.model(Account);
const openAccounts = TypedView.define(connection, OpenAccount, {
  on: Account,
  pipeline: (p) => p.match({ closed: false }).project({ title: 1 }),
});
// ---cut---
try {
  await openAccounts.find();
} catch (error) {
  if (error instanceof ConfigurationError) console.log(error.message);
  // → OpenAccount.find: the view "open_accounts" does not exist in the database "app" (the server would read it as empty); create it first: await connection.init(), or await view.ensure()
}

await connection.init();
console.log(await openAccounts.find());
// → []
