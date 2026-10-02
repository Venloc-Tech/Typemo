import { Entity } from "@venloc/typemo";
import { Prop, Schema } from "@venloc/typemo-decorators";

@Schema({ collection: "users" })
export class User extends Entity {
  @Prop(() => String, { required: true })
  name!: string;
}
