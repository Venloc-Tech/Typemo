import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => BigInt, { required: true })
  balance!: bigint;

  @Prop(() => Date)
  openedAt?: Date;
}
