import { Entity, type HookThis, Pre, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema()
class Line extends Entity {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true }) qty!: number;

  @Pre("document.save")
  report(this: HookThis<"document.save", Line>): void {
    if (this.$isRoot()) {
      console.log("root", JSON.stringify(this.$getChanges()));
      return;
    }
    console.log("subdocument", this.$fullPath());
  }
}
@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => [Line]) lines!: Line[];
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Orders = client.db().model(Order);
// ---cut---
await Orders.create({ lines: [{ sku: "A1", qty: 1 }] });
// → subdocument lines.0
