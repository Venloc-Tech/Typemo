import { Entity, Plugin, Prop, Schema, TypemoClient, type Model, type SchemaPlugin } from "@venloc/typemo";
const statics = {
  async byTitle(this: Model<Product>, title: string): Promise<number> {
    return this.countDocuments({ title });
  },
};
const tools: SchemaPlugin<undefined, typeof statics> = { name: "tools", apply: () => {}, statics };

@Plugin(tools)
@Schema({ collection: "products" })
class Product extends Entity {
  @Prop(() => String, { required: true })
  title!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Products = client.db().model(Product);
// ---cut---
const count = await Products.statics(tools).byTitle("w");
//    ^?
