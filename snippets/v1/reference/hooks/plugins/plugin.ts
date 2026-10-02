import { Entity, Plugin, Prop, Schema, type SchemaPlugin } from "@venloc/typemo";
const audit: SchemaPlugin = {
  name: "audit-log",
  apply: (builder) => {
    builder.addHook("pre", "query.find", function () {
      console.log("чтение товаров");
    });
  },
};
// ---cut---
@Plugin(audit)
@Schema({ collection: "products" })
export class Product extends Entity {
  @Prop(() => String, { required: true })
  title!: string;
}
