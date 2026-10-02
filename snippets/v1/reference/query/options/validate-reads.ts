import { Entity, Index, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Index({ number: 1 })
@Schema({ collection: "orders", softDelete: true })
class Order extends Entity {
  @Prop(() => Number, { required: true }) number!: number;
  @Prop(() => String, { required: true }) status!: string;
  @Prop(() => Date, { nullable: true }) deletedAt?: Date | null;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Orders = client.db().model(Order);
// ---cut---
try {
  await Orders.find().sort({ number: 1 }).validateReads().plain();
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to number failed at path "number" for "4" (string): the stored value does not match the schema of Order (a document read from the database, checked by validateReads) [type]
