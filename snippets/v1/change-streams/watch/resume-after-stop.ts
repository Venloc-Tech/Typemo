import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts", changeStreamPreAndPostImages: true })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// your code: reading and writing the token in durable storage
declare const __loadToken__: () => Promise<{ _data: string } | undefined>;
declare const __saveToken__: (token: unknown) => Promise<void>;
// ---cut---
export const runFeed = async () => {
  const token = await __loadToken__();
  const stream = await Accounts.watch(token === undefined ? {} : { resumeAfter: token });
  for await (const event of stream) {
    console.log("handle", event.operationType);
    await __saveToken__(stream.resumeToken);
  }
};
