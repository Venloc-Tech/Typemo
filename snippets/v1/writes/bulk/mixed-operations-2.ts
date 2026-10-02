import { Entity, fn, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => String) note?: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
const result = await Accounts.bulkWrite([
  {
    updateOne: {
      filter: { title: "Main" },
      update: (p) => p.set((f) => ({ note: fn.concat(f.owner, "-", f.title) })),
    },
  },
]);
console.log(result.modifiedCount, (await Accounts.findOne({ title: "Main" }).orFail()).note);
// → 1 ann-Main
