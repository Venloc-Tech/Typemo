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
// ---cut---
const byString = await Posts.create({ title: "p1", author: ann._id.toHexString() });
const byDocument = await Posts.create({ title: "p2", author: ann }); // [!code highlight]
console.log(byString.author.constructor.name, byDocument.author.constructor.name);
// → ObjectId ObjectId
try {
  await Posts.create({ title: "p3", author: "zz" });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to ObjectId failed at path "author" for "zz" (string): not a 24-character hex string [format]
