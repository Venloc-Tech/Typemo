import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "subscriptions" })
class Subscription extends Entity {
  @Prop(() => [String]) tags!: string[];
  @Prop(() => [Date]) renewals!: Date[];
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Subscriptions = client.db().model(Subscription);
// ---cut---
const sub = await Subscriptions.create({ tags: ["gift"], renewals: [new Date("2026-01-02T03:04:05Z")] });
const hydrated = sub.renewals;
//    ^?
const lean = (await Subscriptions.findById(sub._id).orFail().lean()).renewals;
//    ^?
const json = sub.$toJSON().renewals;
//    ^?
console.log(json);
// → ["2026-01-02T03:04:05.000Z"]
