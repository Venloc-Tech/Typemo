import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "notes" })
export class Note extends Entity {
  @Prop(() => String, { required: true, text: true })
  title!: string;

  @Prop(() => String, { required: true, text: true })
  body!: string;
}
