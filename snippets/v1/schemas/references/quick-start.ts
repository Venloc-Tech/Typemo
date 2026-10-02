import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "authors" })
class Author extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}

@Schema({ collection: "posts" })
export class Post extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Types.ObjectId, { ref: () => Author, required: true })
  author!: Ref<Author>;
}

const Authors = client.connection.model(Author);
const Posts = client.connection.model(Post);
const ann = await Authors.create({ name: "Ann" });
const post = await Posts.create({ title: "Hello", author: ann._id });
console.log(post.author.constructor.name);
// → ObjectId
