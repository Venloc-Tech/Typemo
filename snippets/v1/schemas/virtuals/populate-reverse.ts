import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ collection: "authors" })
class Author extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Virtual({ ref: () => Post, localField: "_id", foreignField: "author" })
  posts!: VirtualRef<Post>;
  @Virtual({ ref: () => Post, localField: "_id", foreignField: "author", count: true }) // [!code ++]
  postCount!: VirtualRef<Post, false, true>; // [!code ++]
}
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Types.ObjectId, { ref: () => Author, required: true }) author!: Ref<Author>;
}
const Authors = client.connection.model(Author);
const Posts = client.connection.model(Post);
const ann = await Authors.create({ name: "Ann" });
await Posts.create({ title: "p1", author: ann._id });
await Posts.create({ title: "p2", author: ann._id });
// ---cut---
const plainRead = await Authors.findOne({ name: "Ann" }).orFail();
console.log(plainRead.posts);
// → undefined
const loaded = await Authors.findOne({ name: "Ann" }).populate("posts").populate("postCount").orFail();
console.log(loaded.posts.map((post) => post.title), loaded.postCount);
// → [ "p1", "p2" ] 2
