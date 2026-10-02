import { Entity, Prop, Schema, Timestamped, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "notes" })
class Note extends Timestamped(Entity) {
  @Prop(() => String, { required: true }) title!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/blog");
const Notes = client.db().model(Note);
// ---cut---
export const newestFirst = (after: string | null) =>
  Notes.keysetPage({ sort: [["createdAt", "desc"]], limit: 2, after });

const page = await newestFirst(null);
console.log(page.items.map((note) => note.title));
// → ["s5", "s4"]
