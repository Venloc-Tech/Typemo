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
import { type AnyPopulationDoc, isPopulated, isPresent } from "@venloc/typemo";

const describe = (post: AnyPopulationDoc<Post>): string[] => {
  const parts: string[] = [];
  if (isPopulated(post, "tags")) parts.push(post.tags.filter(isPresent).map((tag) => tag.label).join("+"));
  if (isPopulated(post, "comments")) parts.push(post.comments.map((comment) => comment.text).join("+"));
  if (isPopulated(post, "commentCount")) parts.push(String(post.commentCount));
  return parts;
};

const post = await Posts.findOne({ title: "Hello" }).populate(["tags", "comments", "commentCount"]).orFail();
console.log(describe(post));
// → ["db+ts", "c1+c2", "2"]

const tagsOnly = async (doc: AnyPopulationDoc<Post>) => {
  if (!isPopulated(doc, "tags")) return undefined;
  return doc.tags;
//           ^?
};
