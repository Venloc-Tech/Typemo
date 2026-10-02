import { type ChangeEvent, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
declare const __sendReceipt__: (orderNumber: string) => Promise<void>;
@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) number!: string;
  @Prop(() => Number, { required: true, min: 0 }) total!: number;
}
@Schema({ collection: "job_checkpoints" })
class Checkpoint extends Entity {
  @Prop(() => String, { required: true, unique: true }) name!: string;
  @Prop(() => String, { required: true }) token!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/shop");
const Orders = client.db().model(Order);
const Checkpoints = client.db().model(Checkpoint);
// ---cut---
export const loadToken = async (name: string): Promise<unknown> => {
  const checkpoint = await Checkpoints.findOne({ name }).plain();
  return checkpoint === null ? undefined : JSON.parse(checkpoint.token);
};

export const saveToken = async (name: string, token: unknown): Promise<void> => {
  await Checkpoints.updateOne({ name }, { $set: { token: JSON.stringify(token) } }, { upsert: true });
};
