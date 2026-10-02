import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "authors" })
export class Author extends Entity {
  @Prop(() => String, { required: true }) name!: string;

  get label(): Computed<string> {
    return `Author ${this.name}` as Computed<string>;
  }

  @Virtual({ ref: () => Post, localField: "_id", foreignField: "author" })
  posts!: VirtualRef<Post>;
}

@Schema({ collection: "posts" })
export class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Types.ObjectId, { ref: () => Author, required: true }) author!: Ref<Author>;
}

const Authors = client.connection.model(Author);
const Posts = client.connection.model(Post);
const ann = await Authors.create({ name: "Ann" });
await Posts.create({ title: "p1", author: ann._id });
const loaded = await Authors.findOne({ name: "Ann" }).populate("posts").orFail();
console.log(loaded.label, loaded.posts.map((post) => post.title));
// → Author Ann [ "p1" ]
