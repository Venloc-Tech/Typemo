import { Entity, Prop, Schema, Typemo, TypemoClient } from "@venloc/typemo";

declare module "@venloc/typemo" {
  interface PropExtensions<V> {
    label?: { readonly text: string };
  }
}

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, ext: { label: { text: "Name" } } })
  title!: string;

  @Prop(() => String, { required: true })
  owner!: string;
}

// 1. global plugins and extensions: before the first model of any client
Typemo.plugin({ name: "log-compiled", apply: (builder) => console.log("schema", builder.target.name) });
Typemo.use({
  name: "label",
  validateProp: (value) => {
    if (typeof value !== "object" || value === null) throw new Error("label: an object is expected");
  },
});

// 2. a subscriber to every client
Typemo.instrument({
  handle: (event) => {
    if (event.type === "operation.end") console.log(`${event.connection}/${event.database}: ${event.operation}`);
  },
});

// 3. clients
const main = await TypemoClient.connect("mongodb://localhost:27017/app", { name: "main" });
const reports = await TypemoClient.connect("mongodb://localhost:27017/reports", { name: "reports" });

// 4. models
const Accounts = main.connection.model(Account);
const ReportAccounts = reports.connection.model(Account);

await Accounts.create({ owner: "alice", title: "Main" });
await ReportAccounts.find();

await Promise.all([main.close(), reports.close()]);
