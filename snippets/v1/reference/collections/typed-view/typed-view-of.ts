import { Entity, Prop, Schema, TypedView, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
@Schema({ collection: "open_accounts" })
class OpenAccount extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const connection = client.connection;
TypedView.define(connection, OpenAccount, {
  on: Account,
  pipeline: (p) => p.project({ title: 1, balance: 1 }),
});
// ---cut---
console.log(TypedView.of(connection).map((view) => view.definition.name));
// → ["open_accounts"]
