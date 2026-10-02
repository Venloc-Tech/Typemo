import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { required: true }) balance!: number;
  @Prop(() => String) status?: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/bank");
const Accounts = client.connection.model(Account);
// ---cut---
const filter: { owner?: string } = {};
try {
  await Accounts.findOneAndUpdate(filter, { $set: { status: "closed" } });
} catch (error) {
  console.log((error as Error).message);
}
// → findOneAndUpdate with an empty filter would change or remove an arbitrary document; pass a filter, or Filters.all() to mean every document on purpose [empty-filter]
