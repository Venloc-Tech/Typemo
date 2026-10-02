import { EntityWithId, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "pages" })
class Page extends EntityWithId(() => String) { // [!code highlight]
  @Prop(() => String, { required: true })
  title!: string;
}

const Pages = client.connection.model(Page);
const page = await Pages.create({ _id: "home", title: "Home" });
console.log(page._id);
// → home
