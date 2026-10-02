import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const raw = client.unsafeDriver().db("app").collection("accounts");
// ---cut---
await client
  .transaction(async (scope) => {
    console.log(scope.attempt, scope.timeoutMS, scope.session.inTransaction());
    // → 1 undefined true
    await raw.insertOne({ title: "Raw", balance: 1 }, { session: scope.session });
    throw new Error("abort");
  })
  .catch(() => undefined);

console.log(await raw.countDocuments({ title: "Raw" }));
// → 0
