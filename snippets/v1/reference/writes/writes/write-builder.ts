import { Entity, Prop, Schema, TypemoClient, WriteBuilder, type UpdateResult } from "@venloc/typemo";
import type { ObjectId } from "mongodb";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String) note?: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
const annotate = (title: string): WriteBuilder<UpdateResult<ObjectId>> =>
  Accounts.updateOne({ title }, { $set: { note: "checked" } });

await annotate("Main").orFail();
