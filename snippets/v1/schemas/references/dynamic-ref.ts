import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ collection: "authors" })
class Author extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
@Schema({ collection: "bots" })
class Bot extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
@Schema({ collection: "comments" })
class Comment extends Entity {
  @Prop(() => String, { required: true }) kind!: string;
  @Prop(() => Types.ObjectId, { refPath: "kind", required: true }) // [!code highlight]
  target!: Ref<Author | Bot>;
}
const Authors = client.connection.model(Author);
const Bots = client.connection.model(Bot);
const Comments = client.connection.model(Comment);
const bot = await Bots.create({ name: "R2" });
await Comments.create({ kind: "Bot", target: bot._id });
// ---cut---
const comment = await Comments.findOne({ kind: "Bot" }).populate("target").orFail();
console.log((comment.target as { name?: string }).name);
// → R2
