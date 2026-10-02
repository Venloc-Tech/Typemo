import { type Decimal128 } from "mongodb";
import { Entity, Prop, Schema, Types } from "@venloc/typemo";

@Schema({ collection: "rates" })
export class Rate extends Entity {
  @Prop(() => String, { required: true, unique: true })
  pair!: string;

  @Prop(() => Types.Decimal128, { required: true })
  value!: Decimal128;
}
