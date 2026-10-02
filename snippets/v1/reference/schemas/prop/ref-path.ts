import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Comment extends Entity {
  @Prop(() => String) kind?: string;
  @Prop(() => Types.ObjectId, { refPath: "kind" }) // [!code highlight]
  target?: Ref<Author | Bot>;
}
@Schema()
class Author extends Entity {
  @Prop(() => String) name?: string;
}
@Schema()
class Bot extends Entity {
  @Prop(() => String) name?: string;
}
const Comments = client.db().model(Comment);
const comment = await Comments.findOne({ kind: "Bot" }).populate("target").orFail();
console.log((comment.target as { name?: string }).name);
// → R2
