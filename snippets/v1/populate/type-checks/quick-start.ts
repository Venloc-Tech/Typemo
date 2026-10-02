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
import { type AnyPopulationDoc, type HydratedDoc, isPopulated } from "@venloc/typemo";

// option 1: the type comes from the function that loads it
const loadPost = () => Posts.findOne({ title: "Hello" }).populate("author").orFail();
type LoadedPost = Awaited<ReturnType<typeof loadPost>>;
const authorOf = (post: LoadedPost) => post.author?.name;

// option 2: the function takes a post in any state
const signature = (post: AnyPopulationDoc<Post>): string =>
  isPopulated(post, "author") ? `— ${post.author?.name}` : "—";

// option 3: another function loaded the relation, and here it is required
const warmUp = async (post: HydratedDoc<Post>) => {
  await post.$populate("author");
};
const post = await Posts.findOne({ title: "Hello" }).orFail();
await warmUp(post);
const authorName = post.$assertPopulated("author").author?.name;

console.log(authorOf(await loadPost()), signature(await loadPost()), signature(post), authorName);
// → "Alice" "— Alice" "— Alice" "Alice"
