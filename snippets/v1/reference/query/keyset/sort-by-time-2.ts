import { Entity, Prop, Schema, Timestamped, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "notes" })
class Note extends Timestamped(Entity) {
  @Prop(() => String, { required: true }) title!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Notes = client.db().model(Note);
// ---cut---
const note = await Notes.findOne({ title: "s1" }).orFail();
note.title = "s1x";
await note.$save();

const recent = await Notes.keysetPage({ sort: [["updatedAt", "desc"]], limit: 2 });
console.log(recent.items.map((item) => item.title));
// → ["s1x", "s5"]
