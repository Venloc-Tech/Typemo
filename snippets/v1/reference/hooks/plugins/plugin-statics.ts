import { Entity, Prop, Schema, type PluginStatics, type Model, type SchemaPlugin } from "@venloc/typemo";
@Schema({ collection: "products" })
class Product extends Entity {
  @Prop(() => String, { required: true }) title!: string;
}
// ---cut---
const statics = {
  async byTitle(this: Model<Product>, title: string): Promise<number> {
    return this.countDocuments({ title });
  },
};
const tools: SchemaPlugin<undefined, typeof statics> = { name: "tools", apply: () => {}, statics };

type Bound = PluginStatics<typeof tools>;
//   ^?
