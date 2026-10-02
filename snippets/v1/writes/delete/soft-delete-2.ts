import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "notes", softDelete: true })
class Note extends Entity {
  @Prop(() => String, { required: true })
  text!: string;

  @Prop(() => Date, { nullable: true })
  deletedAt?: Date | null;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Notes = client.db().model(Note);
// ---cut---
await Notes.deleteMany({ text: "second" }).policy({ hardDelete: true });

console.log(await Notes.countDocuments());
// → 0
console.log(await Notes.countDocuments().policy({ includeDeleted: true }));
// → 1
