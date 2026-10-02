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
const runReceiptWorker = async (signal: AbortSignal): Promise<void> => {};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// ---cut---
const first = new AbortController();
const running = runReceiptWorker(first.signal);
await sleep(300);
await Orders.create({ number: "A-1", total: 10 });
await sleep(300);
first.abort();
await running;

await Orders.create({ number: "A-2", total: 20 }); // written while the worker is stopped

const second = new AbortController();
const resumed = runReceiptWorker(second.signal);
await sleep(300);
second.abort();
await resumed;
// receipts sent: A-1, A-2 (each once)
