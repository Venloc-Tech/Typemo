// @filename: models.ts
import { Entity, Prop, type Ref, Schema, Types } from "@venloc/typemo";

@Schema({ collection: "users" })
export class User extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String, { required: true, unique: true })
  email!: string;
}

@Schema({ collection: "posts" })
export class Post extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Boolean, { required: true })
  published!: boolean;

  @Prop(() => Types.ObjectId, { ref: () => User, required: true })
  author!: Ref<User>;
}
// @filename: main.ts
// ---cut---
import { TypemoClient } from "@venloc/typemo";
import { Post, User } from "./models.ts";

const client = await TypemoClient.connect("mongodb://localhost:27017/blog");
const Users = client.connection.model(User);
const Posts = client.connection.model(Post);
await client.connection.init();

const alice = await Users.create({ name: "Alice", email: "alice@example.com" });
const post = await Posts.create({ title: "Hello", published: false, author: alice._id });

const drafts = await Posts.find({ published: false }).plain(); // [!code ++]
console.log(drafts); // [!code ++]
// → [{ _id: "…", title: "Hello", published: false, author: "…" }]

const result = await Posts.updateOne({ _id: post._id }, { $set: { published: true } }); // [!code ++]
console.log(result.modifiedCount); // [!code ++]
// → 1

const found = await Posts.findOne({ title: "Hello" }).populate({ path: "author", required: true }).orFail().plain(); // [!code ++]
//    ^?
console.log(found.author.name); // [!code ++]
// → "Alice"

await client.close(); // [!code ++]
