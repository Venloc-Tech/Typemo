import { Entity, Prop, Schema, Timestamped, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "notes" })
class Note extends Timestamped(Entity) {
  @Prop(() => String, { required: true }) title!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Notes = client.db().model(Note);
// ---cut---
const page1 = await Notes.keysetPage({ sort: [["createdAt", "asc"]], limit: 2 });
console.log(page1.items.map((note) => note.title));
// → ["s1", "s2"]

const page2 = await Notes.keysetPage({ sort: [["createdAt", "asc"]], limit: 2, after: page1.nextCursor });
console.log(page2.items.map((note) => note.title));
// → ["s3", "s4"]
