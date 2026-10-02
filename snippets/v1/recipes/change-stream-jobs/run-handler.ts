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
const loadToken = async (name: string): Promise<unknown> => undefined;
const saveToken = async (name: string, token: unknown): Promise<void> => {};
// ---cut---
export const runReceiptWorker = async (signal: AbortSignal): Promise<void> => {
  const resumeAfter = await loadToken("receipts");
  const stream = await Orders.watch(
    (pipeline) => pipeline.match({ operationType: "insert" }),
    resumeAfter === undefined ? {} : { resumeAfter },
  );
  signal.addEventListener("abort", () => void stream.close());

  const process = async (event: ChangeEvent<Order>): Promise<void> => {
    if (event.operationType !== "insert") return;
    await __sendReceipt__(event.fullDocument.number);
    await saveToken("receipts", stream.resumeToken);
  };

  for await (const event of stream) await process(event);
};
