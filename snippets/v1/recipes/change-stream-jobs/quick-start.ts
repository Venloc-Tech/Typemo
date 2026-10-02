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
const stream = await Orders.watch((pipeline) => pipeline.match({ operationType: "insert" }));

await Orders.create({ number: "A-1", total: 10 });

const event = await stream.next();
if (event.operationType === "insert") console.log(event.fullDocument.number);
// → "A-1"
await stream.close();
