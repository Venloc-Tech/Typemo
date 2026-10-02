import { Decimal128, UUID } from "mongodb";
import { Entity, Prop, Schema, Types } from "@venloc/typemo";

@Schema({ collection: "readings" })
export class Reading extends Entity {
  @Prop(() => String, { required: true })
  label!: string;

  @Prop(() => BigInt)
  total?: bigint;

  @Prop(() => Types.Decimal128)
  weight?: Decimal128;

  @Prop(() => Types.UUID)
  device?: UUID;

  @Prop(() => Date)
  at?: Date;
}
