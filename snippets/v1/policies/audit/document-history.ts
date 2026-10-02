import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "transfers", audit: true })
class Transfer extends Entity {
  @Prop(() => String, { required: true }) from!: string;
  @Prop(() => Number, { required: true }) amount!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Transfers = client.connection.model(Transfer);
// ---cut---
await client.transaction(async () => {
  const rows = await Transfers.find({ from: "A" }).select({ _id: 1 }).lean();
  await Transfers.updateMany({ _id: { $in: rows.map((row) => row._id) } }, { $set: { amount: 0 } });
});
