import { Entity, Index, Prop, Schema } from "@venloc/typemo";

@Schema()
export class GeoPoint {
  @Prop(() => String, { required: true, enum: ["Point"] })
  type!: "Point";

  @Prop(() => [Number], { required: true })
  coordinates!: number[];
}

@Schema()
export class Variant {
  @Prop(() => String, { required: true })
  sku!: string;

  @Prop(() => Number, { required: true })
  qty!: number;
}

@Index({ place: "2dsphere" })
@Schema({ collection: "products" })
export class Product extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => Number, { required: true })
  price!: number;

  @Prop(() => Number, { required: true })
  stock!: number;

  @Prop(() => [String])
  tags!: string[];

  @Prop(() => Date)
  released?: Date;

  @Prop(() => String, { nullable: true })
  note!: string | null;

  @Prop(() => [Variant])
  variants!: Variant[];

  @Prop(() => Number)
  flags?: number;

  @Prop(() => GeoPoint)
  place?: GeoPoint;
}
