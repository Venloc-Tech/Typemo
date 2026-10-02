import { Entity, type Hidden, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number, { required: true })
  balance!: number;

  @Prop(() => String)
  note?: string;

  @Prop(() => String, { hidden: true })
  pin?: Hidden<string>;
}
