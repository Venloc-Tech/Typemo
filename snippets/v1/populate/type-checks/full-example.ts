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
import { type AnyPopulationDoc, type HydratedDoc, isPopulated, isPresent } from "@venloc/typemo";

// the type of the loaded post comes from the function that loads it
export const loadPost = (title: string) => Posts.findOne({ title }).populate("author").orFail();
export type LoadedPost = Awaited<ReturnType<typeof loadPost>>;

export const subject = (post: LoadedPost) =>
  `${post.title} by ${isPresent(post.author) ? post.author.name : "аноним"}`;

// a post in any state: a signature if the author is loaded
export const footer = (post: AnyPopulationDoc<Post>): string =>
  isPopulated(post, "author") ? `— ${post.author?.name ?? "аноним"}` : "";

// other code loaded the relation; here it is required and gets the exact type
export const signature = async (post: HydratedDoc<Post>) => {
  await post.$populate("author");
  const loaded = post.$assertPopulated("author");
  return `— ${loaded.author?.name ?? "аноним"}`;
};

// branching without an error (after `signature` the author of `bare` is loaded)
export const isReady = (post: HydratedDoc<Post>) => post.$populated("author") !== undefined;

const post = await loadPost("Hello");
const bare = await Posts.findOne({ title: "Hello" }).orFail();
console.log(subject(post), footer(bare), await signature(bare), isReady(bare));
// → "Hello by Alice" "" "— Alice" true
