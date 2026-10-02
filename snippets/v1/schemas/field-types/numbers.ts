import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => Number, { required: true }) limit!: number;
}
const Accounts = client.connection.model(Account);
// ---cut---
await Accounts.create({ limit: 5 });
await Accounts.create({ limit: 1.5 });
const kinds = await client
  .unsafeDriver()
  .db("shop")
  .collection("accounts")
  .aggregate([{ $project: { _id: 0, limit: 1, type: { $type: "$limit" } } }])
  .toArray();
console.log(kinds);
// → [{ limit: 5, type: "int" }, { limit: 1.5, type: "double" }]
