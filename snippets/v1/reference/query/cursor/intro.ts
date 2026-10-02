import { Entity, Prop, Schema, TypemoClient, type QueryCursor } from "@venloc/typemo";
@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => Number, { required: true }) number!: number;
  @Prop(() => String, { required: true }) status!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Orders = client.db().model(Order);
// ---cut---
export const countRows = async (rows: QueryCursor<{ number: number }>): Promise<number> => {
  let total = 0;
  for await (const _row of rows) total += 1;
  return total;
};

const cursor = Orders.find().plain().cursor();
//    ^?
console.log(await countRows(cursor));
// → 5
