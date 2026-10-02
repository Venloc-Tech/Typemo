import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
  @Prop(() => String, { sensitive: "mask" }) iban?: string;
}

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "bank" });
const Accounts = client.db().model(Account);
// ---cut---
client.instrument({
  handle: (event) => {
    if (event.type === "operation.start") console.log(JSON.stringify(event.summary.filter));
  },
});

await Accounts.find({ balance: { $gt: 50 }, iban: "DE00" }).plain();
// → {"balance":{"$gt":"?"},"iban":"?"}
