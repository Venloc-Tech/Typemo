import { ObjectId } from "mongodb";
import { type AuditEntry, type Defaulted, Entity, PolicyContext, Post, Prop, Schema, TypemoClient } from "@venloc/typemo";
declare const __publish__: (event: { type: string; title: string }) => void;
@Schema({ collection: "accounts", audit: true })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { min: 0, default: 0 }) balance!: Defaulted<number>;
  @Prop(() => String, { sensitive: "mask" }) card?: string;
  @Post("document.save")
  announce(this: Account): void {
    __publish__({ type: "account.saved", title: this.title });
  }
}
const client = await TypemoClient.connect("mongodb://localhost:27017/bank");
const Accounts = client.db().model(Account);
const asActor = <R>(userId: string, work: () => R): R => PolicyContext.run({ actor: userId }, work);
// ---cut---
const account = await asActor("user-1", () => Accounts.create({ title: "Main", card: "5500000000000004" }));

const trail = client.unsafeDriver().db("bank").collection("accounts_audit");
console.log(await trail.countDocuments({ actor: "user-1" }));
// → 1
