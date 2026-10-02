import { type ChangeEvent, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

// your code: sends the receipt of an order
declare const __sendReceipt__: (orderNumber: string) => Promise<void>;

// jobs/models.ts
@Schema({ collection: "orders" })
export class Order extends Entity {
  @Prop(() => String, { required: true })
  number!: string;

  @Prop(() => Number, { required: true, min: 0 })
  total!: number;
}

@Schema({ collection: "job_checkpoints" })
export class Checkpoint extends Entity {
  @Prop(() => String, { required: true, unique: true })
  name!: string;

  @Prop(() => String, { required: true })
  token!: string;
}

export const client = await TypemoClient.connect("mongodb://localhost:27017/shop");
const Orders = client.db().model(Order);
const Checkpoints = client.db().model(Checkpoint);

// jobs/checkpoint.ts: the resume token is kept as a JSON string
export const loadToken = async (name: string): Promise<unknown> => {
  const checkpoint = await Checkpoints.findOne({ name }).plain();
  return checkpoint === null ? undefined : JSON.parse(checkpoint.token);
};

export const saveToken = async (name: string, token: unknown): Promise<void> => {
  await Checkpoints.updateOne({ name }, { $set: { token: JSON.stringify(token) } }, { upsert: true });
};

// jobs/receipts.ts: at-least-once processing with a checkpoint after each event
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
