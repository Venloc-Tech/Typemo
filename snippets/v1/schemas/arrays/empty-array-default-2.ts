import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ collection: "legacy_orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => [String]) tags!: string[];
}
const Orders = client.connection.model(Order);
// ---cut---
await client.unsafeDriver().db("shop").collection("legacy_orders").insertOne({ customer: "old" });

const doc = await Orders.findOne({ customer: "old" }).orFail();
console.log(doc.tags.length);
// → 0
const lean = await Orders.findOne({ customer: "old" }).orFail().lean();
console.log("tags" in lean);
// → false
