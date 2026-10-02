import { Entity, Plugin, Prop, Schema, type SchemaPlugin } from "@venloc/typemo";
// ---cut---
export const noted: SchemaPlugin<{ readonly field: string }> = {
  name: "noted",
  apply: (builder, options) => {
    builder.addField(options.field, () => String);
  },
};

@Plugin(noted, { field: "note" })
@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;
}
