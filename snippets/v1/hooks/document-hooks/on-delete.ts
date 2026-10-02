import { Entity, Post, Pre, Prop, Schema, TypemoClient, type DeleteResult } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;

  @Pre("document.deleteOne")
  beforeDelete(this: Account): void {
    console.log(`удаляем ${this.title}`);
  }

  @Post("document.deleteOne")
  afterDelete(this: Account, result: DeleteResult): void {
    console.log(`удалено: ${result.deletedCount}`);
  }
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
const account = await Accounts.findOne({ title: "Main" }).orFail();
await account.$deleteOne();
// → удаляем Main
// → удалено: 1
