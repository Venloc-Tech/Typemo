import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Post extends Entity { // [!code highlight]
  @Prop(() => String, { required: true })
  title!: string;
}
const Posts = client.db().model(Post);
const post = await Posts.create({ title: "Hello" });
console.log(post._id.constructor.name);
// → ObjectId
