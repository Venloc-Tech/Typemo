import { type Defaulted, Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true, unique: true })
  title!: string;

  @Prop(() => BigInt, { min: 0n, default: 0n })
  balance!: Defaulted<bigint>;
}
