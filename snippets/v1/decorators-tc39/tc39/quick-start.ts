import { Entity } from "@venloc/typemo";
import { Prop, Schema } from "@venloc/typemo-decorators";

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true, trim: true })
  title!: string;

  @Prop(() => Number, { min: 0 })
  balance!: number;
}
