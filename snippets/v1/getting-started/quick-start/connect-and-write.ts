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
console.log(alice.name);
// → "Alice"

const post = await Posts.create({ title: "Hello", published: false, author: alice._id });
console.log(post.title, post.published);
// → "Hello" false
