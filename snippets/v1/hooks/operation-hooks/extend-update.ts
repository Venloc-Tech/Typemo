import { type Defaulted, Entity, Pre, Prop, Schema, TypemoClient, type OperationHookContext } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Boolean, { default: false }) archived!: Defaulted<boolean>;
  @Prop(() => Number, { default: 0 }) revision!: Defaulted<number>; // [!code ++]

  @Pre("query.updateMany") // [!code ++]
  bumpRevision(this: OperationHookContext<Account, "query.updateMany">): void { // [!code ++]
    this.modify({ update: { $inc: { revision: 1 } } }); // [!code ++]
  } // [!code ++]
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
const result = await Accounts.updateMany({ owner: "alice" }, { $set: { archived: true } });
console.log(result.modifiedCount);
// → 2
