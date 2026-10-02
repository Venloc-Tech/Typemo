import { Entity, Prop, Schema, Spec, Versioned } from "@venloc/typemo";

@Schema({ nested: true })
export class Address {
  @Prop(() => String, { required: true })
  city!: string;

  @Prop(() => String)
  street?: string;
}

@Schema()
export class Line extends Entity {
  @Prop(() => String, { required: true })
  sku!: string;

  @Prop(() => Number, { required: true, min: 0 })
  qty!: number;
}

@Schema({ collection: "orders" })
export class Order extends Versioned(Entity) {
  @Prop(() => String, { required: true })
  customer!: string;

  @Prop(() => [String])
  tags!: string[];

  @Prop(() => [Line])
  lines!: Line[];

  @Prop(() => Address)
  address?: Address;

  @Prop(() => Spec.map(Number))
  fees?: Map<string, number>;
}
