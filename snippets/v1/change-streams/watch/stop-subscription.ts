import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts", changeStreamPreAndPostImages: true })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
export const startFeed = async () => {
  const stream = await Accounts.watch();
  const loop = (async () => {
    for await (const event of stream) console.log(event.operationType);
  })();
  return { stop: async () => { await stream.close(); await loop; } };
};
