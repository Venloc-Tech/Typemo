import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "users" })
export class User extends Entity {
  @Prop(() => String, { required: true, unique: true })
  email!: string;

  @Prop(() => String, { required: true, minLength: 2 })
  name!: string;
}
