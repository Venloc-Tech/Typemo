import { Entity, Mask, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "payments" })
class Payment extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => String, { sensitive: Mask.card() }) card?: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Payments = client.db().model(Payment);
// ---cut---
client.instrument({
  sensitive: "show",
  handle: (event) => {
    if (event.type === "operation.start") console.log(event.summary);
  },
});
await Payments.find({ owner: "ann", card: "4242 4242 4242 4242" }).plain();
// → { filter: { owner: "ann", card: "************4242" } }
// with the default sensitive ("mask"): { filter: { owner: "?", card: "************4242" } }
// with sensitive: "hide": { filter: { owner: "[hidden]", card: "************4242" } }
