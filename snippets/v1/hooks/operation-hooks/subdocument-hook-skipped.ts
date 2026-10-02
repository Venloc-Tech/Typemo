import { Entity, Pre, Prop, Schema, type OperationHookContext } from "@venloc/typemo";

@Schema()
class Line extends Entity {
  @Prop(() => String, { required: true }) sku!: string;

  @Pre("query.find") // [!code warning]
  withSku(this: OperationHookContext<Line, "query.find">): void {
    this.modify({ where: { sku: { $ne: "" } } });
  }
}

@Schema({ collection: "orders" })
export class Order extends Entity {
  @Prop(() => [Line]) lines!: Line[];
}
