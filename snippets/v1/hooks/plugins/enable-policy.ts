import { Entity, Plugin, Prop, Schema, type SchemaPlugin } from "@venloc/typemo";
// ---cut---
export const softly: SchemaPlugin = {
  name: "softly",
  apply: (builder) => builder.enablePolicy("softDelete", true),
};

@Plugin(softly)
@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Date, { nullable: true })
  deletedAt?: Date | null;
}
