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
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) views!: number;
  @Prop(() => Types.ObjectId, { ref: () => User, required: true }) author!: Ref<User>;
  @Prop(() => Types.ObjectId, { ref: () => User }) editor?: Ref<User>;
  @Prop(() => [Types.ObjectId], { ref: () => Tag }) tags!: Ref<Tag>[];
  @Prop(() => Spec.map(Types.ObjectId), { ref: () => User }) reviewers?: Map<string, Ref<User>>;
  @Virtual({ ref: () => Comment, localField: "_id", foreignField: "post" }) comments?: VirtualRef<Comment>;
  @Virtual({ ref: () => Comment, localField: "_id", foreignField: "post", count: true }) commentCount?: VirtualRef<Comment, false, true>;
}
@Schema({ collection: "comments" })
class Comment extends Entity {
  @Prop(() => String, { required: true }) text!: string;
  @Prop(() => Types.ObjectId, { ref: () => Post, required: true }) post!: Ref<Post>;
  @Prop(() => Types.ObjectId, { ref: () => User, required: true }) author!: Ref<User>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "blog" });
const Users = client.db().model(User);
const Tags = client.db().model(Tag);
const Posts = client.db().model(Post);
const Comments = client.db().model(Comment);
// ---cut---
// only the author's name
const named = await Posts.find({ title: "Hello" })
  .populate({ path: "author", select: { name: 1, _id: 0 } })
  .plain();
console.log(named[0]?.author);
// → { name: "Alice" }

// the number of comments instead of the comments themselves
const counted = await Posts.find({ title: "Hello" }).populate("commentCount").plain();
console.log(counted[0]?.commentCount);
// → 2

// at most one comment per post
const limited = await Posts.find({ title: "Hello" }).populate({ path: "comments", perDocumentLimit: 1 }).plain();
console.log(limited[0]?.comments.length);
// → 1
