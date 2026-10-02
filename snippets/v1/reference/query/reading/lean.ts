import { Entity, Prop, Schema, Spec, Types } from "@venloc/typemo";
import type { Decimal128 } from "mongodb";

@Schema({ collection: "wallets" })
export class Wallet extends Entity {
  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => BigInt)
  points?: bigint;

  @Prop(() => Types.Decimal128)
  balance?: Decimal128;

  @Prop(() => Date)
  opened?: Date;

  @Prop(() => Spec.map(Number))
  limits?: Map<string, number>;
}
