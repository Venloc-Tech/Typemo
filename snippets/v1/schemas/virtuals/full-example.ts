import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
// models: posts reference the author, the author describes the reverse link
@Schema({ collection: "authors" })
class Author extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  get label(): Computed<string> {
    return `Author ${this.name}` as Computed<string>;
  }
  @Virtual({ ref: () => Post, localField: "_id", foreignField: "author" })
  posts!: VirtualRef<Post>;
}

@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Types.ObjectId, { ref: () => Author, required: true }) author!: Ref<Author>;
}

// your code: the error at the application boundary
class __NotFound__ extends Error {}

// author profile: posts are loaded in one query
export const authorProfile = async (name: string) => {
  const Authors = client.connection.model(Author);
  client.connection.model(Post);
  const author = await Authors.findOne({ name }).populate("posts");
  if (author === null) throw new __NotFound__(name);
  return { label: author.label, titles: author.posts.map((post) => post.title) };
};

const ann = await client.connection.model(Author).create({ name: "Ann" });
await client.connection.model(Post).create({ title: "Hello", author: ann._id });
console.log(await authorProfile("Ann"));
// → { label: "Author Ann", titles: [ "Hello" ] }
