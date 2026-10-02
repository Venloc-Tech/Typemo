import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type SpecValue, type TenantField, type VirtualRef, type VirtualValue, type Unbranded, type Int64String, type Vector } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Post extends Entity {
  @Prop(() => Types.ObjectId, { required: true }) author!: Types.ObjectId;
}
@Schema()
class Author extends Entity {
  @Virtual({ ref: () => Post, localField: "_id", foreignField: "author" }) // [!code highlight]
  posts!: VirtualRef<Post>;
  @Virtual({ ref: () => Post, localField: "_id", foreignField: "author", count: true }) // [!code highlight]
  postCount!: VirtualRef<Post, false, true>;
}
