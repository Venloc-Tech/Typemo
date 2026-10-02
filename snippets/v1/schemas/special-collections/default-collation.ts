import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "names", collation: { locale: "en", strength: 2 } }) // [!code highlight]
class Named extends Entity {
  @Prop(() => String) name?: string;
}

const Names = client.db().model(Named);
await client.db().init();
await Names.create({ name: "Anna" });
const found = await Names.find({ name: "anna" }).plain();
console.log(found.length);
// → 1
