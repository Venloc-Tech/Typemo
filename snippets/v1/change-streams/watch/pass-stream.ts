import { Entity, Prop, Schema, TypemoClient, type ModelChangeStream } from "@venloc/typemo";
@Schema({ collection: "accounts", changeStreamPreAndPostImages: true })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
export const take = async <E>(stream: ModelChangeStream<E>, count: number): Promise<E[]> => {
  const events: E[] = [];
  while (events.length < count) events.push(await stream.next());
  return events;
};

const stream = await Accounts.watch({ fullDocument: "updateLookup" });
await Accounts.create({ owner: "mia", balance: 1 });
const [first] = await take(stream, 1);
//     ^?
await stream.close();
