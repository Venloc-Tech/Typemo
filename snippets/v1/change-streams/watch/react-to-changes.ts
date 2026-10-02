import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts", changeStreamPreAndPostImages: true })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// your code: evicting a cache entry
declare const __dropFromCache__: (id: string) => void;
// ---cut---
export const watchAccounts = async () => {
  const stream = await Accounts.watch();
  for await (const event of stream) {
    switch (event.operationType) {
      case "insert":
      case "update":
      case "replace":
      case "delete":
        __dropFromCache__(String(event.documentKey._id));
        break;
      default:
        console.log("collection event:", event.operationType);
    }
  }
};
