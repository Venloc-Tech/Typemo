import { Entity, Plugin, Prop, Schema, type SchemaPlugin } from "@venloc/typemo";
const seenAt: SchemaPlugin<{ readonly field: string }> = {
  name: "seen-at",
  apply: (builder, options) => {
    builder.addField(options.field, () => Date);
  },
};
// ---cut---
@Plugin(seenAt, { field: "seenAt" })
@Schema({ collection: "products" })
export class Product extends Entity {
  @Prop(() => String, { required: true })
  title!: string;
}
