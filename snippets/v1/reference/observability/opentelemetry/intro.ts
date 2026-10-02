import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true, unique: true })
  title!: string;

  @Prop(() => Number, { required: true })
  balance!: number;

  @Prop(() => String, { sensitive: "mask" })
  iban?: string;
}
