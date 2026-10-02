import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type VirtualValue, type Unbranded, type Int64String, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Post extends Entity {
  @Prop(() => Types.ObjectId, { required: true }) author!: Types.ObjectId;
  @Prop(() => String) title?: string;
  @Prop(() => Number) rank?: number;
}
@Schema()
class Author extends Entity {
  @Prop(() => String) name?: string;
  @Virtual({
    ref: () => Post, localField: "_id", foreignField: "author",
    perDocumentLimit: 1, options: { sort: { rank: -1 } }, // [!code highlight]
  })
  top!: VirtualRef<Post>;
}
const Authors = client.db().model(Author);
const authors = await Authors.find({ name: { $exists: true } }).sort({ name: 1 }).populate("top");
console.log(authors.map((author) => [author.name, author.top.map((post) => post.title)]));
// → [["Ann", ["a4"]], ["Bob", ["b2"]]]
