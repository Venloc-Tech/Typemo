import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Author extends Entity {
  @Prop(() => String) name?: string;
}
@Schema()
class Post extends Entity {
  @Prop(() => Types.ObjectId, { ref: () => Author }) // [!code highlight]
  author?: Ref<Author>;
}
const Authors = client.db().model(Author);
const Posts = client.db().model(Post);
const post = await Posts.findOne({}).populate("author").orFail();
console.log((post.author as { name?: string }).name);
// → Ann
