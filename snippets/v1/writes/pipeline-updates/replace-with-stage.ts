import { Entity, fn, type Immutable, Prop, Schema, Timestamped, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "stamped" })
class Stamped extends Timestamped(Entity) {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true, immutable: true }) owner!: Immutable<string>;
  @Prop(() => String) note?: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Stampeds = client.db().model(Stamped);
// ---cut---
await Stampeds.updateOne({ title: "first" }, (p) =>
  p.replaceWith((f) => ({ title: fn.literal("second"), owner: f.owner, createdAt: f.createdAt })),
);
// → document: title "second", the old owner and createdAt, the note field is gone
