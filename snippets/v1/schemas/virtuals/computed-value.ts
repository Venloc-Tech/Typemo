import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ collection: "authors" })
class Author extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  get label(): Computed<string> {
    return `Author ${this.name}` as Computed<string>;
  }
}
const Authors = client.connection.model(Author);
await Authors.create({ name: "Ann" });
// ---cut---
const author = await Authors.findOne({ name: "Ann" }).orFail();
console.log(author.$toPlain());
// → { _id: "…", name: "Ann" }
console.log(author.$toPlain({ virtuals: true }));
// → { _id: "…", name: "Ann", label: "Author Ann" }
try {
  (author as { label: string }).label = "x";
} catch (error) {
  console.log((error as Error).message);
}
// → Attempted to assign to readonly property.
