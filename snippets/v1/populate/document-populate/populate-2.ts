import { Entity, Prop, Schema, TypemoClient, Types, type Ref } from "@venloc/typemo";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
@Schema({ collection: "tags" })
class Tag extends Entity {
  @Prop(() => String, { required: true }) label!: string;
}
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Types.ObjectId, { ref: () => User, required: true }) author!: Ref<User>;
  @Prop(() => [Types.ObjectId], { ref: () => Tag }) tags!: Ref<Tag>[];
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "blog" });
const Posts = client.db().model(Post);
// ---cut---
const post = await Posts.findOne({ title: "Hello" }).orFail();
const loaded = await post.$populate(["author", { path: "tags", select: { label: 1 } }]);
console.log(loaded.author?.name, loaded.tags.map((tag) => tag.label));
// → Ann ["db", "ts"]
