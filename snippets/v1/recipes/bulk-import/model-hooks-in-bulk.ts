import { Entity, Prop, Pre, Schema, type OperationHookContext } from "@venloc/typemo";

@Schema({ collection: "products" })
export class Product extends Entity {
  @Prop(() => String, { required: true, unique: true })
  sku!: string;

  @Prop(() => String, { required: true, unique: true })
  name!: string;

  @Prop(() => Number, { required: true, min: 0 })
  price!: number;

  @Pre("query.updateOne")
  rejectReserved(this: OperationHookContext<Product, "query.updateOne">): void {
    const sku = (this.filter as { sku?: string }).sku;
    if (this.bulkIndex !== undefined && sku?.startsWith("X-")) throw new Error(`sku ${sku} is reserved`);
  }
}
