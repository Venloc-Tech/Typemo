import { Entity, Prop, Schema, TypemoClient, PolicyContext } from "@venloc/typemo";
@Schema({ collection: "transfers", audit: true })
class Transfer extends Entity {
  @Prop(() => String, { required: true }) from!: string;
  @Prop(() => Number, { required: true }) amount!: number;
  @Prop(() => String, { sensitive: "mask" }) card?: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Transfers = client.connection.model(Transfer);
// ---cut---
await PolicyContext.run({ actor: "user-7" }, () =>
  Transfers.updateOne({ from: "A" }, { $set: { amount: 90, card: "5500000000000004" } }),
);

const trail = client.unsafeDriver().db("app").collection("transfers_audit");
const entry = await trail.findOne({ operation: "updateOne" });
console.log(entry);
// → { model: "Transfer", collection: "transfers", operation: "updateOne", document: false,
//     actor: "user-7", outcome: "ok", filter: { from: "A" },
//     update: { $set: { amount: 90, card: "?" } },
//     result: { matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null }, … }
