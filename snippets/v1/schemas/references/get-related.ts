import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ collection: "authors" })
class Author extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Types.ObjectId, { ref: () => Author, required: true }) author!: Ref<Author>;
}
const Authors = client.connection.model(Author);
const Posts = client.connection.model(Post);
const ann = await Authors.create({ name: "Ann" });
await Posts.create({ title: "Hello", author: ann._id });
await Posts.create({ title: "Orphan", author: new Types.ObjectId() });
// ---cut---
const post = await Posts.findOne({ title: "Hello" }).populate("author").orFail();
console.log(post.author?.name);
// → Ann
const orphan = await Posts.findOne({ title: "Orphan" }).populate("author").orFail();
console.log(orphan.author);
// → null
