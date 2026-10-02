import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "members" })
export class Member extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String, { enum: ["user", "editor", "admin"], required: true })
  role!: "user" | "editor" | "admin";

  @Prop(() => String)
  nickname?: string;

  @Prop(() => Number)
  age?: number;

  @Prop(() => [String])
  tags!: string[];
}
