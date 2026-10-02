import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Post extends Timestamped(Entity) { // [!code highlight]
  @Prop(() => String)
  title?: string;
}
const Posts = client.db().model(Post);
const post = await Posts.create({ title: "a" });
const created = post.createdAt.getTime();
const updated = post.updatedAt.getTime();
post.title = "b";
await post.$save();
console.log(post.createdAt.getTime() === created, post.updatedAt.getTime() > updated);
// → true true
