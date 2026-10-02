import { Entity, Prop, Schema, Spec } from "@venloc/typemo";

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Spec.map(String)) // [!code ++]
  labels?: Map<string, string>; // [!code ++]
}
