import { Entity, Post, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;

  @Post("document.init")
  afterRead(this: Account): void {
    console.log(`прочитан счёт ${this.title}`);
  }
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
await Accounts.findOne({ title: "Main" });
// → прочитан счёт Main
await Accounts.findOne({ title: "Main" }).lean();
