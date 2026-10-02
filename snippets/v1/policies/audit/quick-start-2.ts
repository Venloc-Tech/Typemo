import { Entity, Prop, Schema, TypemoClient, PolicyContext } from "@venloc/typemo";
@Schema({ collection: "transfers", audit: true })
class Transfer extends Entity {
  @Prop(() => String, { required: true }) from!: string;
  @Prop(() => Number, { required: true }) amount!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Transfers = client.connection.model(Transfer);
// ---cut---
await PolicyContext.run({ actor: "user-7" }, () => Transfers.create({ from: "A", amount: 100 }));
