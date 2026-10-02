import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Ref, type VirtualRef } from "@venloc/typemo";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String) email?: string;
  @Virtual({ ref: () => Post, localField: "_id", foreignField: "author" }) posts?: VirtualRef<Post>;
}
@Schema({ collection: "tags" })
class Tag extends Entity {
  @Prop(() => String, { required: true }) label!: string;
}
@Schema()
class Attachment {
  @Prop(() => String, { required: true }) file!: string;
  @Prop(() => Types.ObjectId, { ref: () => User }) uploader?: Ref<User>;
}
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) views!: number;
  @Prop(() => Types.ObjectId, { ref: () => User, required: true }) author!: Ref<User>;
  @Prop(() => [Types.ObjectId], { ref: () => Tag }) tags!: Ref<Tag>[];
  @Prop(() => Spec.map(Types.ObjectId), { ref: () => User }) reviewers?: Map<string, Ref<User>>;
  @Prop(() => [Attachment]) attachments!: Attachment[];
  @Virtual({ ref: () => Comment, localField: "_id", foreignField: "post" }) comments?: VirtualRef<Comment>;
}
@Schema({ collection: "comments" })
class Comment extends Entity {
  @Prop(() => String, { required: true }) text!: string;
  @Prop(() => Types.ObjectId, { ref: () => Post, required: true }) post!: Ref<Post>;
  @Prop(() => Types.ObjectId, { ref: () => User, required: true }) author!: Ref<User>;
}
@Schema({ collection: "activities" })
class Activity extends Entity {
  @Prop(() => String, { required: true, enum: ["Post", "Comment"] }) kind!: "Post" | "Comment";
  @Prop(() => Types.ObjectId, { refPath: "kind", required: true }) target!: Ref<Post | Comment>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "blog" });
const Users = client.db().model(User);
const Tags = client.db().model(Tag);
const Posts = client.db().model(Post);
const Comments = client.db().model(Comment);
const Activities = client.db().model(Activity);
// ---cut---
const post = await Posts.findOne({ title: "Hello" }).populate("reviewers.$*").orFail();
console.log(post.reviewers?.get("lead")?.name, post.reviewers?.get("second")?.name);
// → "Bob" "Alice"
