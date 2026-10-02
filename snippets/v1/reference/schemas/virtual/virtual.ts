import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type VirtualValue, type Unbranded, type Int64String, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Post extends Entity {
  @Prop(() => Types.ObjectId, { required: true }) author!: Types.ObjectId;
  @Prop(() => String) title?: string;
}
@Schema()
class Author extends Entity {
  @Prop(() => String) name?: string;
  @Virtual({ ref: () => Post, localField: "_id", foreignField: "author" }) // [!code highlight]
  posts!: VirtualRef<Post>;
}
const Authors = client.db().model(Author);
const author = await Authors.findOne({ name: "Ann" }).populate("posts").orFail();
console.log(author.posts.map((post) => post.title));
// → ["a1", "a2", "a3", "a4"]
