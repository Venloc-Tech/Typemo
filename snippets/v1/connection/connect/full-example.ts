import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true })
  title!: string;

  @Prop(() => String, { required: true })
  owner!: string;
}

// your code: the error at the application boundary
class __NotFound__ extends Error {}

const main = async () => {
  // client: one connection string, the database named explicitly
  const client = await TypemoClient.connect("mongodb://localhost:27017/app", { name: "main" });

  // state: log every change
  client.onStateChange((state) => console.log("db:", state));

  // environment check: transactions need a replica set
  if (client.supportsTransactions === false) throw new Error("replica set required");

  // database setup: create the missing indexes
  const Accounts = client.connection.model(Account);
  await client.connection.init();

  // work with the model
  await Accounts.create({ owner: "alice", title: "Main" });
  const found = await Accounts.findOne({ owner: "alice" }).orFail();
  if (found.title !== "Main") throw new __NotFound__("account is missing");

  // close on shutdown
  await client.close();
};

await main();
