import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
// models: a post references the author by id
@Schema({ collection: "authors" })
class Author extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}

@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Types.ObjectId, { ref: () => Author, required: true }) author!: Ref<Author>;
}

// your code: the error at the application boundary
class __NotFound__ extends Error {}

// publishing: the author id comes as a string from the URL
export const publish = async (authorId: string, title: string) => {
  const Posts = client.connection.model(Post);
  return Posts.create({ title, author: authorId });
};

// read: the author is loaded by a query
export const readPost = async (title: string) => {
  const Posts = client.connection.model(Post);
  const post = await Posts.findOne({ title }).populate("author").orFail();
  if (post.author === null) throw new __NotFound__("author is missing");
  return { title: post.title, author: post.author.name };
};

const ann = await client.connection.model(Author).create({ name: "Ann" });
await publish(ann._id.toHexString(), "Hello");
console.log(await readPost("Hello"));
// → { title: "Hello", author: "Ann" }
