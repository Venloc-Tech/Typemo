import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "users" })
export class User extends Entity {
  @Prop(() => String, { required: true, trim: true })
  name!: string;

  @Prop(() => String, { required: true, unique: true, lowercase: true })
  email!: string;
}
