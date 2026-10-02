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
// a list for the home page: author and tags, no extra fields
export const listPosts = async () => {
  const posts = await Posts.find()
    .sort({ title: 1 })
    .populate([
      { path: "author", select: { name: 1 } },
      { path: "tags", select: { label: 1 } },
    ])
    .plain();
  return posts.map((post) => ({
    title: post.title,
    author: post.author?.name,
    tags: post.tags.map((tag) => tag.label),
  }));
};

// post page: the author and comments with their authors
export const readPost = async (title: string) => {
  const post = await Posts.findOne({ title })
    .populate(["author", { path: "comments", populate: { path: "author", select: { name: 1 } } }])
    .orFail()
    .plain();
  return {
    title: post.title,
    author: post.author?.name,
    comments: post.comments.map((comment) => `${comment.author?.name}: ${comment.text}`),
  };
};

console.log(await listPosts());
// → [{ title: "Bob's", author: "Bob", tags: [] }, { title: "Hello", author: "Alice", tags: ["db", "ts"] }, { title: "Second", author: "Alice", tags: ["ts"] }]
console.log(await readPost("Hello"));
// → { title: "Hello", author: "Alice", comments: ["Bob: c1", "Alice: c2"] }
